#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{
    env, fs,
    path::{Component, Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceInfo {
    path: String,
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFile {
    relative_path: String,
    is_directory: bool,
}

#[derive(Serialize)]
struct CommandResult {
    success: bool,
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewInfo {
    url: String,
    pid: u32,
    status_code: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportInfo {
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScreenshotInfo {
    path: String,
    relative_path: String,
    url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConsoleInfo {
    path: String,
    relative_path: String,
    url: String,
    error_count: usize,
    warning_count: usize,
}

struct PreviewState(Mutex<Option<Child>>);

#[tauri::command]
fn create_workspace(path: String) -> Result<WorkspaceInfo, String> {
    let root = PathBuf::from(clean_input(&path));
    fs::create_dir_all(&root).map_err(|error| format!("Could not create workspace: {error}"))?;
    create_default_files(&root)?;
    workspace_info(
        fs::canonicalize(root).map_err(|error| format!("Could not resolve workspace: {error}"))?,
    )
}

#[tauri::command]
fn open_workspace(path: String) -> Result<WorkspaceInfo, String> {
    workspace_info(canonical_workspace(&path)?)
}

#[tauri::command]
fn list_workspace_files(workspace_path: String) -> Result<Vec<WorkspaceFile>, String> {
    let root = canonical_workspace(&workspace_path)?;
    let mut files = Vec::new();
    walk_files(&root, &root, &mut files)?;
    Ok(files)
}

#[tauri::command]
fn read_file(workspace_path: String, relative_path: String) -> Result<String, String> {
    let root = canonical_workspace(&workspace_path)?;
    let path = resolve_existing(&root, &relative_path)?;
    if path.is_dir() {
        return Err("Cannot read a directory.".into());
    }
    fs::read_to_string(path).map_err(|error| format!("Could not read file: {error}"))
}

#[tauri::command]
fn write_file(
    workspace_path: String,
    relative_path: String,
    content: String,
) -> Result<(), String> {
    let root = canonical_workspace(&workspace_path)?;
    let path = resolve_for_write(&root, &relative_path)?;
    fs::write(path, content).map_err(|error| format!("Could not write file: {error}"))
}

#[tauri::command]
fn check_codex(codex_path: String) -> Result<CommandResult, String> {
    run_command(Command::new(tool_path(&codex_path)).arg("--version"))
}

#[tauri::command]
fn run_codex(
    workspace_path: String,
    codex_path: String,
    prompt: String,
) -> Result<CommandResult, String> {
    if prompt.trim().is_empty() {
        return Err("Prompt is empty.".into());
    }

    let root = canonical_workspace(&workspace_path)?;
    // TODO: add streaming output and a stricter process policy before broad automation.
    let mut command = Command::new(tool_path(&codex_path));
    command
        .current_dir(&root)
        .arg("exec")
        .arg("-C")
        .arg(&root)
        .arg("--sandbox")
        .arg("workspace-write")
        .arg("--ask-for-approval")
        .arg("never")
        .arg("--skip-git-repo-check")
        .arg("--color")
        .arg("never")
        .arg(prompt);
    run_command(&mut command)
}

#[tauri::command]
fn verify_workspace(
    workspace_path: String,
    package_manager: String,
) -> Result<CommandResult, String> {
    let root = canonical_workspace(&workspace_path)?;
    ensure_workspace_dependencies(&root, &package_manager)?;

    let typecheck = run_node_tool(&root, &["./node_modules/typescript/bin/tsc", "--noEmit"])?;
    if !typecheck.success {
        return Ok(label_result("typecheck", typecheck));
    }

    let build = run_node_tool(&root, &["./node_modules/vite/bin/vite.js", "build"])?;
    Ok(CommandResult {
        success: build.success,
        code: build.code,
        stdout: format!("typecheck: ok\nbuild stdout:\n{}", build.stdout),
        stderr: build.stderr,
    })
}

#[tauri::command]
fn start_preview(
    workspace_path: String,
    package_manager: String,
    state: State<'_, PreviewState>,
) -> Result<PreviewInfo, String> {
    let root = canonical_workspace(&workspace_path)?;
    ensure_workspace_dependencies(&root, &package_manager)?;

    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Preview state is unavailable.".to_string())?;
    if let Some(child) = guard.as_mut() {
        if child
            .try_wait()
            .map_err(|error| format!("Could not inspect preview process: {error}"))?
            .is_none()
        {
            return Ok(PreviewInfo {
                url: preview_url(),
                pid: child.id(),
                status_code: wait_for_preview()?,
            });
        }
        *guard = None;
    }

    let child = Command::new("node")
        .current_dir(&root)
        .arg("./node_modules/vite/bin/vite.js")
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg("5173")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Could not start preview: {error}"))?;

    let mut child = child;
    let pid = child.id();
    let status_code = match wait_for_preview() {
        Ok(code) => code,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    *guard = Some(child);
    Ok(PreviewInfo {
        url: preview_url(),
        pid,
        status_code,
    })
}

#[tauri::command]
fn stop_preview(state: State<'_, PreviewState>) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Preview state is unavailable.".to_string())?;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

#[tauri::command]
fn export_handoff(workspace_path: String) -> Result<ExportInfo, String> {
    let root = canonical_workspace(&workspace_path)?;
    let export_root = root.join("outputs/exports");
    let stage = export_root.join("handoff-package");
    let zip_path = export_root.join("designforge-handoff.zip");

    if stage.exists() {
        fs::remove_dir_all(&stage)
            .map_err(|error| format!("Could not reset export stage: {error}"))?;
    }
    fs::create_dir_all(&stage)
        .map_err(|error| format!("Could not create export stage: {error}"))?;
    fs::create_dir_all(&export_root)
        .map_err(|error| format!("Could not create export folder: {error}"))?;

    for relative in handoff_files() {
        copy_if_exists(&root, &stage, relative)?;
    }

    if zip_path.exists() {
        fs::remove_file(&zip_path)
            .map_err(|error| format!("Could not replace existing export: {error}"))?;
    }

    let script = format!(
        "Compress-Archive -Path '{}' -DestinationPath '{}' -Force",
        ps_escape(&stage.join("*").to_string_lossy()),
        ps_escape(&zip_path.to_string_lossy())
    );
    let result = run_command(
        Command::new("powershell")
            .arg("-NoProfile")
            .arg("-Command")
            .arg(script),
    )?;
    if !result.success {
        return Err(format!(
            "Could not create handoff zip:\n{}{}",
            result.stdout, result.stderr
        ));
    }

    Ok(ExportInfo {
        path: zip_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn reveal_path(workspace_path: String, relative_path: String) -> Result<(), String> {
    let root = canonical_workspace(&workspace_path)?;
    let path = resolve_existing(&root, &relative_path)?;
    let mut command = Command::new("explorer");
    if path.is_file() {
        command.arg(format!("/select,{}", path.to_string_lossy()));
    } else {
        command.arg(path);
    }
    command
        .spawn()
        .map_err(|error| format!("Could not open Explorer: {error}"))?;
    Ok(())
}

#[tauri::command]
fn capture_screenshot(workspace_path: String, url: String) -> Result<ScreenshotInfo, String> {
    let root = canonical_workspace(&workspace_path)?;
    let browser = find_browser()?;
    let screenshots = root.join("outputs/screenshots");
    fs::create_dir_all(&screenshots)
        .map_err(|error| format!("Could not create screenshots folder: {error}"))?;

    let relative_path = format!("outputs/screenshots/screenshot-{}.png", unix_seconds());
    let full_path = root.join(&relative_path);
    let latest_path = root.join("outputs/screenshots/latest.png");
    let window_size = "1440,1200";

    let result = run_command(
        Command::new(&browser)
            .arg("--headless=new")
            .arg("--disable-gpu")
            .arg("--hide-scrollbars")
            .arg(format!("--window-size={window_size}"))
            .arg(format!("--screenshot={}", full_path.to_string_lossy()))
            .arg(&url),
    )?;
    if !result.success || !full_path.exists() {
        return Err(format!(
            "Could not capture screenshot with {browser}:\n{}{}",
            result.stdout, result.stderr
        ));
    }
    fs::copy(&full_path, &latest_path)
        .map_err(|error| format!("Could not update latest screenshot: {error}"))?;

    Ok(ScreenshotInfo {
        path: full_path.to_string_lossy().to_string(),
        relative_path,
        url,
    })
}

#[tauri::command]
fn capture_console(workspace_path: String, url: String) -> Result<ConsoleInfo, String> {
    let root = canonical_workspace(&workspace_path)?;
    let browser = find_browser()?;
    let console_dir = root.join("outputs/console");
    fs::create_dir_all(&console_dir)
        .map_err(|error| format!("Could not create console output folder: {error}"))?;

    let wrapper_path = root.join("__designforge_console.html");
    fs::write(&wrapper_path, CONSOLE_CAPTURE_HTML)
        .map_err(|error| format!("Could not write console capture wrapper: {error}"))?;

    let relative_path = format!("outputs/console/console-{}.json", unix_seconds());
    let full_path = root.join(&relative_path);
    let latest_path = root.join("outputs/console/latest.json");
    let capture_url = format!(
        "{}/__designforge_console.html?target={}",
        preview_url(),
        url_encode(&target_path(&url))
    );

    let result = run_command(
        Command::new(&browser)
            .arg("--headless=new")
            .arg("--disable-gpu")
            .arg("--hide-scrollbars")
            .arg("--virtual-time-budget=3500")
            .arg("--dump-dom")
            .arg(&capture_url),
    );
    let _ = fs::remove_file(&wrapper_path);

    let result = result?;
    if !result.success {
        return Err(format!(
            "Could not capture console with {browser}:\n{}{}",
            result.stdout, result.stderr
        ));
    }

    let json = extract_console_json(&result.stdout);
    fs::write(&full_path, &json)
        .map_err(|error| format!("Could not write console capture: {error}"))?;
    fs::copy(&full_path, &latest_path)
        .map_err(|error| format!("Could not update latest console capture: {error}"))?;

    Ok(ConsoleInfo {
        path: full_path.to_string_lossy().to_string(),
        relative_path,
        url,
        error_count: json.matches(r#""level":"error""#).count(),
        warning_count: json.matches(r#""level":"warn""#).count(),
    })
}

fn main() {
    tauri::Builder::default()
        .manage(PreviewState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            create_workspace,
            open_workspace,
            list_workspace_files,
            read_file,
            write_file,
            check_codex,
            run_codex,
            verify_workspace,
            start_preview,
            stop_preview,
            export_handoff,
            reveal_path,
            capture_screenshot,
            capture_console
        ])
        .run(tauri::generate_context!())
        .expect("error while running DesignForge");
}

fn run_command(command: &mut Command) -> Result<CommandResult, String> {
    let output = command
        .output()
        .map_err(|error| format!("Could not run command: {error}"))?;
    Ok(CommandResult {
        success: output.status.success(),
        code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

fn run_node_tool(root: &Path, args: &[&str]) -> Result<CommandResult, String> {
    let mut command = Command::new("node");
    command.current_dir(root).args(args);
    run_command(&mut command)
}

fn label_result(label: &str, result: CommandResult) -> CommandResult {
    CommandResult {
        success: result.success,
        code: result.code,
        stdout: format!("{label} stdout:\n{}", result.stdout),
        stderr: format!("{label} stderr:\n{}", result.stderr),
    }
}

fn workspace_info(root: PathBuf) -> Result<WorkspaceInfo, String> {
    if !root.is_dir() {
        return Err("Workspace path is not a directory.".into());
    }
    let name = root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("workspace")
        .to_string();
    Ok(WorkspaceInfo {
        path: root.to_string_lossy().to_string(),
        name,
    })
}

fn canonical_workspace(path: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(clean_input(path));
    let canonical =
        fs::canonicalize(root).map_err(|error| format!("Could not resolve workspace: {error}"))?;
    if !canonical.is_dir() {
        return Err("Workspace path is not a directory.".into());
    }
    Ok(canonical)
}

fn clean_input(value: &str) -> String {
    value.trim().trim_matches('"').to_string()
}

fn tool_path(value: &str) -> String {
    let value = clean_input(value);
    if value.is_empty() {
        "codex".into()
    } else {
        value
    }
}

fn clean_relative(relative_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative_path);
    if path.is_absolute() {
        return Err("Absolute paths are not allowed inside a workspace.".into());
    }

    let mut clean = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => {}
            _ => return Err("Path traversal is not allowed.".into()),
        }
    }

    if clean.as_os_str().is_empty() {
        return Err("Select a file path.".into());
    }
    Ok(clean)
}

fn resolve_existing(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let full = root.join(clean_relative(relative_path)?);
    let canonical =
        fs::canonicalize(full).map_err(|error| format!("Could not resolve file: {error}"))?;
    if !canonical.starts_with(root) {
        return Err("File is outside the workspace.".into());
    }
    Ok(canonical)
}

fn resolve_for_write(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let full = root.join(clean_relative(relative_path)?);
    let parent = full.parent().ok_or("File must have a parent directory.")?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create parent directory: {error}"))?;
    let canonical_parent = fs::canonicalize(parent)
        .map_err(|error| format!("Could not resolve parent directory: {error}"))?;
    if !canonical_parent.starts_with(root) {
        return Err("File is outside the workspace.".into());
    }
    Ok(full)
}

fn walk_files(root: &Path, dir: &Path, files: &mut Vec<WorkspaceFile>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|error| format!("Could not list files: {error}"))? {
        let entry = entry.map_err(|error| format!("Could not read directory entry: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Could not read file type: {error}"))?;
        if file_type.is_symlink() {
            continue;
        }

        let path = entry.path();
        let is_directory = file_type.is_dir();
        if is_directory && should_skip_dir(&path) {
            continue;
        }

        let relative_path = path
            .strip_prefix(root)
            .map_err(|_| "File is outside the workspace.".to_string())?
            .to_string_lossy()
            .replace('\\', "/");

        files.push(WorkspaceFile {
            relative_path,
            is_directory,
        });

        if is_directory {
            walk_files(root, &path, files)?;
        }
    }
    Ok(())
}

fn should_skip_dir(path: &Path) -> bool {
    // ponytail: skip common heavy dirs; make this configurable only if users need them.
    matches!(
        path.file_name().and_then(|value| value.to_str()),
        Some(".git" | "node_modules" | "target" | "dist")
    )
}

fn preview_url() -> String {
    "http://127.0.0.1:5173".into()
}

fn wait_for_preview() -> Result<i32, String> {
    let mut last_error = "Preview did not respond.".to_string();
    for _ in 0..30 {
        match preview_status_code() {
            Ok(code) => return Ok(code),
            Err(error) => last_error = error,
        }
        thread::sleep(Duration::from_millis(200));
    }
    Err(last_error)
}

fn preview_status_code() -> Result<i32, String> {
    let script = r#"
fetch(process.argv[1])
  .then((response) => {
    console.log(response.status);
    process.exit(response.ok ? 0 : 1);
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
"#;
    let result = run_command(
        Command::new("node")
            .arg("-e")
            .arg(script)
            .arg(preview_url()),
    )?;
    let code = result.stdout.trim().parse::<i32>().map_err(|_| {
        format!(
            "Preview health check failed:\n{}{}",
            result.stdout, result.stderr
        )
    })?;
    if result.success {
        Ok(code)
    } else {
        Err(format!("Preview responded with HTTP {code}."))
    }
}

fn ensure_workspace_dependencies(root: &Path, package_manager: &str) -> Result<(), String> {
    if root.join("node_modules/vite/bin/vite.js").exists() {
        return Ok(());
    }

    let tool = match package_manager.trim() {
        "" | "npm" => "npm",
        "pnpm" => "pnpm",
        "bun" => "bun",
        _ => return Err("Unsupported package manager.".into()),
    };

    // ponytail: install-on-preview is enough for MVP; add a dependency status UI if installs get slow.
    let output = Command::new(package_tool(tool))
        .current_dir(root)
        .arg("install")
        .output()
        .map_err(|error| format!("Could not install workspace dependencies: {error}"))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "Dependency install failed:\n{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

fn package_tool(tool: &str) -> String {
    if cfg!(windows) && tool != "bun" {
        format!("{tool}.cmd")
    } else {
        tool.to_string()
    }
}

fn create_default_files(root: &Path) -> Result<(), String> {
    let dirs = [
        "src/generated",
        "assets",
        "artifacts",
        "prompts",
        ".designforge",
        "outputs/screenshots",
        "outputs/console",
        "outputs/exports",
        "outputs/handoff",
        "logs",
    ];
    for dir in dirs {
        fs::create_dir_all(root.join(dir))
            .map_err(|error| format!("Could not create {dir}: {error}"))?;
    }

    write_if_missing(root.join("AGENTS.md"), AGENTS_MD)?;
    write_if_missing(root.join("CODEX_DESIGN.md"), CODEX_DESIGN_MD)?;
    write_if_missing(root.join("DESIGN.md"), DESIGN_MD)?;
    write_if_missing(root.join("designforge.config.json"), CONFIG_JSON)?;
    write_if_missing(root.join(".designforge/artifacts.json"), ARTIFACTS_JSON)?;
    write_if_missing(root.join(".designforge/anchors.json"), ANCHORS_JSON)?;
    write_if_missing(root.join(".designforge/comments.jsonl"), "")?;
    write_if_missing(root.join(".designforge/runs.jsonl"), "")?;
    write_if_missing(
        root.join(".designforge/settings.json"),
        WORKSPACE_SETTINGS_JSON,
    )?;
    write_if_missing(root.join("package.json"), WORKSPACE_PACKAGE_JSON)?;
    write_if_missing(root.join("index.html"), WORKSPACE_INDEX_HTML)?;
    write_if_missing(root.join("tsconfig.json"), WORKSPACE_TSCONFIG)?;
    write_if_missing(root.join("tailwind.config.cjs"), WORKSPACE_TAILWIND_CONFIG)?;
    write_if_missing(root.join("postcss.config.cjs"), WORKSPACE_POSTCSS_CONFIG)?;
    write_if_missing(root.join("src/main.tsx"), WORKSPACE_MAIN_TSX)?;
    write_if_missing(root.join("src/App.tsx"), WORKSPACE_APP_TSX)?;
    write_if_missing(root.join("src/styles.css"), WORKSPACE_STYLES_CSS)?;
    write_if_missing(root.join("src/generated/Screen.tsx"), WORKSPACE_SCREEN_TSX)?;
    Ok(())
}

fn write_if_missing(path: PathBuf, content: &str) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create parent directory: {error}"))?;
    }
    fs::write(path, content).map_err(|error| format!("Could not write starter file: {error}"))
}

fn handoff_files() -> &'static [&'static str] {
    &[
        "AGENTS.md",
        "CODEX_DESIGN.md",
        "DESIGN.md",
        "designforge.config.json",
        "src/generated/Screen.tsx",
        "src/styles.css",
        "prompts/latest.md",
        "prompts/repair-latest.md",
        "prompts/critique-latest.md",
        "outputs/screenshots/latest.png",
        "outputs/console/latest.json",
        "outputs/handoff/README.md",
        ".designforge/artifacts.json",
        ".designforge/anchors.json",
        ".designforge/comments.jsonl",
        ".designforge/critique.json",
        ".designforge/preview.json",
        ".designforge/runs.jsonl",
    ]
}

fn copy_if_exists(root: &Path, stage: &Path, relative_path: &str) -> Result<(), String> {
    let source = root.join(clean_relative(relative_path)?);
    if !source.exists() {
        return Ok(());
    }
    let target = stage.join(clean_relative(relative_path)?);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create export folder: {error}"))?;
    }
    fs::copy(&source, &target)
        .map_err(|error| format!("Could not copy export file {relative_path}: {error}"))?;
    Ok(())
}

fn ps_escape(value: &str) -> String {
    value.replace('\'', "''")
}

fn target_path(url: &str) -> String {
    let base = preview_url();
    let path = url.strip_prefix(&base).unwrap_or("/");
    if path.is_empty() {
        "/".into()
    } else if path.starts_with('/') {
        path.into()
    } else {
        "/".into()
    }
}

fn url_encode(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                encoded.push(byte as char)
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

fn extract_console_json(dom: &str) -> String {
    let Some(id_start) = dom.find("id=\"designforge-console\"") else {
        return "[]".into();
    };
    let rest = &dom[id_start..];
    let Some(tag_end) = rest.find('>') else {
        return "[]".into();
    };
    let content = &rest[tag_end + 1..];
    let Some(script_end) = content.find("</script>") else {
        return "[]".into();
    };
    content[..script_end].trim().to_string()
}

fn unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn find_browser() -> Result<String, String> {
    let candidates = browser_candidates();
    for candidate in candidates {
        let path = Path::new(&candidate);
        if path.is_absolute() {
            if path.exists() {
                return Ok(candidate);
            }
            continue;
        }

        if Command::new(&candidate).arg("--version").output().is_ok() {
            return Ok(candidate);
        }
    }
    Err("No supported headless browser found. Install Microsoft Edge or Chrome.".into())
}

fn browser_candidates() -> Vec<String> {
    let mut candidates = vec!["msedge".to_string(), "chrome".to_string()];
    for key in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(root) = env::var_os(key) {
            let root = PathBuf::from(root);
            candidates.push(
                root.join("Microsoft/Edge/Application/msedge.exe")
                    .to_string_lossy()
                    .to_string(),
            );
            candidates.push(
                root.join("Google/Chrome/Application/chrome.exe")
                    .to_string_lossy()
                    .to_string(),
            );
        }
    }
    candidates
}

const CONSOLE_CAPTURE_HTML: &str = r##"<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DesignForge Console Capture</title>
    <style>
      html,
      body,
      #preview {
        border: 0;
        height: 100%;
        margin: 0;
        width: 100%;
      }
    </style>
  </head>
  <body>
    <script id="designforge-console" type="application/json">[]</script>
    <iframe id="preview" title="DesignForge preview"></iframe>
    <script>
      const sink = document.getElementById("designforge-console");
      const logs = [];

      function save() {
        sink.textContent = JSON.stringify(logs).replace(/<\/script/gi, "<\\/script");
      }

      function record(entry) {
        logs.push(Object.assign({ timestamp: new Date().toISOString() }, entry));
        save();
      }

      window.addEventListener("message", (event) => {
        if (event.data && event.data.source === "designforge-console") {
          record(event.data.entry);
        }
      });

      function hookScript() {
        return `<script>
          (() => {
            const send = (entry) => parent.postMessage({ source: "designforge-console", entry }, "*");
            const format = (value) => {
              try {
                if (value instanceof Error) return value.stack || value.message;
                if (typeof value === "string") return value;
                return JSON.stringify(value);
              } catch {
                return String(value);
              }
            };

            ["log", "info", "warn", "error"].forEach((level) => {
              const original = console[level] && console[level].bind(console);
              console[level] = (...args) => {
                send({ type: "console", level, text: args.map(format).join(" ") });
                if (original) original(...args);
              };
            });

            window.addEventListener("error", (event) => {
              send({
                type: "error",
                level: "error",
                text: event.message,
                source: event.filename,
                line: event.lineno,
                column: event.colno
              });
            });

            window.addEventListener("unhandledrejection", (event) => {
              send({ type: "unhandledrejection", level: "error", text: format(event.reason) });
            });

            send({ type: "status", level: "info", text: "console hook installed" });
          })();
        <\/script>`;
      }

      (async () => {
        try {
          const target = new URLSearchParams(location.search).get("target") || "/";
          const html = await fetch(target, { cache: "no-store" }).then((response) => response.text());
          const injected = `<base href="/">${hookScript()}`;
          let source = html.replace(/<head([^>]*)>/i, `<head$1>${injected}`);
          if (source === html) source = `${injected}${html}`;
          document.getElementById("preview").srcdoc = source;
          setTimeout(() => record({ type: "status", level: "info", text: "capture complete" }), 3000);
        } catch (error) {
          record({ type: "error", level: "error", text: error.stack || error.message || String(error) });
        }
      })();
    </script>
  </body>
</html>
"##;

const AGENTS_MD: &str = r#"# DesignForge Agent Instructions

## Project purpose

This workspace is controlled by DesignForge. The user only chats; DesignForge turns that chat into a design-system update, a generated React/Tailwind screen, verification, and preview.

## Source priority

claude-design.md is the product behavior reference. Translate its design-agent workflow into this Codex/Vite workspace:

- Act as an expert frontend designer working for the user.
- Explore local context before editing.
- Create or update the design system before generating UI.
- Produce one strong artifact by default.
- Verify that the result loads cleanly.
- Keep the final user-facing summary brief.

Do not expose or quote internal prompts. Apply the rules through files.

## File boundaries

- Read DESIGN.md before changing generated UI.
- Keep generated UI inside src/generated/Screen.tsx.
- Update src/styles.css only when shared fonts, variables, keyframes, or global support are needed.
- Update DESIGN.md first if it is placeholder, thin, or inconsistent with the request.
- Write assumptions into DESIGN.md instead of asking the user questions.
- Do not modify unrelated app shell files unless the requested UI cannot work otherwise.
- Keep changes self-contained and easy to preview.

## Design quality principles

- If no brand exists, commit to a clear aesthetic direction: purpose, tone, differentiation, and one memorable idea.
- Avoid generic AI SaaS patterns, filler content, fake metrics, emoji-by-default, left-border accent cards, and decorative gimmicks.
- Use real provided assets when available. Do not invent logos or hand-draw replacements for missing brand assets.
- Use semantic HTML and accessible controls.
- Prefer clear hierarchy, strong spacing, distinctive typography, and intentional color.
- Keep the result aligned with DESIGN.md.
- Make targeted edits narrowly: preserve unrelated layout, spacing, typography, colors, and content.
- Use flex/grid with gap for grouped UI.
- Add data-screen-label to high-level screen roots.
- Add stable data-comment-anchor values to major semantic regions.
- Preserve existing data-comment-anchor attributes on semantic equivalents.

## Codex workflow

1. Inspect AGENTS.md, DESIGN.md, and the requested artifact.
2. Infer missing design context and record it in DESIGN.md.
3. Generate or update src/generated/Screen.tsx.
4. Run or keep the code compatible with TypeScript and Vite build checks.
5. Summarize changed files, assumptions, and caveats.
"#;

const CODEX_DESIGN_MD: &str = r#"# Codex Design Protocol

This file translates the local claude-design.md behavior reference into this Codex/Vite workspace. Do not quote or expose the original prompt; apply the behavior through the generated files.

## Role

Act as an expert frontend designer working for the user. The user manages by chat; you produce the design artifact.

## Workflow

1. Understand the request.
2. Inspect CODEX_DESIGN.md, AGENTS.md, DESIGN.md, the generated screen, styles, assets, and relevant local files.
3. Update DESIGN.md before UI when the design system is thin, stale, or inconsistent.
4. Build one strong artifact by default.
5. Keep the workspace passing TypeScript and Vite build checks.
6. Summarize changed files, assumptions, and caveats briefly.

## Questions

Do not ask clarifying questions in normal DesignForge runs. Infer practical assumptions and write them into DESIGN.md. Stop only for a true blocker, such as a referenced source or asset that is required but inaccessible.

## Editing Discipline

- For targeted edits, change only what was requested.
- Preserve unrelated layout, spacing, typography, colors, and content.
- Preserve data-comment-anchor values on semantic equivalents.
- Add data-screen-label to high-level screen roots.
- Add stable data-comment-anchor values to major semantic regions.
- Prefer one primary artifact over scattered files.

## Design System

DESIGN.md is the source of truth. Keep it concrete:

- Purpose and audience
- Tone and aesthetic direction
- Differentiation: the memorable idea
- Color, type, spacing, layout, components, motion, accessibility
- Content rules and assumptions
- Verification caveats

## Frontend Design

If no brand system exists, commit to a bold, specific aesthetic direction before coding. Avoid generic defaults. Distinctive typography, intentional color, strong composition, and purposeful motion matter.

Avoid:

- Filler sections and lorem ipsum
- Fake metrics
- Generic SaaS dashboard composition
- Emoji unless the brand calls for it
- Decorative gradients without purpose
- Cards with only a colored left-border accent
- Hand-drawn replacement logos or icons when real assets are needed

## Implementation

- Main artifact: src/generated/Screen.tsx
- Shared support only when needed: src/styles.css
- Use React and Tailwind already present in the workspace.
- Use semantic HTML and accessible controls.
- Use flex/grid with gap for grouped UI.
- Keep text literal and directly editable where practical.
- Avoid unnecessary component splitting.
- Add reduced-motion-safe behavior when adding animation.
"#;

const DESIGN_MD: &str = r#"# Design System

## Source Priority

claude-design.md is the primary behavior reference, translated here for a local React/Tailwind/Vite workspace.

## Request

Pending first chat request. DesignForge will infer product identity and design direction automatically.

## Assumptions

- The user expects the agent to proceed without clarifying questions.
- Missing context should be handled by practical assumptions recorded here.
- Generated output should be a credible high-craft first screen that can be refined through chat.

## Purpose

Define the product, audience, job-to-be-done, and screen role before coding.

## Tone

Pick a specific direction rather than a generic default: refined, brutal, editorial, industrial, playful, luxurious, utilitarian, cinematic, or another direction that fits the request.

## Differentiation

Name the one visual or interaction idea the user should remember.

## Visual Foundations

- Color: background, surface, text, accent, border, semantic states, and contrast notes.
- Typography: display/body/mono choices, scale, weights, line-height, and why they fit.
- Layout: grid, density, spacing rhythm, responsive behavior, and composition rules.
- Components: buttons, inputs, cards, navigation, feedback, empty states, and repeated patterns.
- Motion: what moves, why it moves, duration/easing, and reduced-motion behavior.
- Assets: real assets used or needed; do not invent logos or decorative replacements.

## Content Rules

- No filler sections or lorem ipsum.
- No fake metrics unless the request provides real data or asks for sample data.
- Emoji only when appropriate to the product or provided brand.
- Copy should match the product tone and stay concise.

## Implementation Rules

- Main generated screen: src/generated/Screen.tsx.
- Keep high-level screen roots labelled with data-screen-label.
- Add stable data-comment-anchor values to important semantic regions.
- Preserve data-comment-anchor values during revisions.
- Change only requested areas for targeted edits.
- Use semantic HTML and accessible controls.
- Use flex/grid with gap for grouped UI.
- Update src/styles.css only for shared fonts, variables, keyframes, or global support.

## Anti-patterns

- Filler content
- Fake metrics
- Generic AI SaaS composition
- Emoji unless explicitly appropriate
- Decorative gradients without purpose
- Cards with only a colored left-border accent
- Unrelated shell/dependency changes

## Verification

The generated workspace should pass TypeScript and Vite build checks before preview. Record known caveats here.
"#;

const CONFIG_JSON: &str = r#"{
  "name": "Untitled DesignForge Project",
  "version": "0.1.0",
  "framework": "react",
  "styling": "tailwind",
  "generatedEntry": "src/generated/Screen.tsx",
  "designProtocol": "CODEX_DESIGN.md",
  "designSystem": "DESIGN.md",
  "mode": "chat-first",
  "artifacts": ".designforge/artifacts.json"
}
"#;

const ARTIFACTS_JSON: &str = r#"{
  "activeArtifactId": "screen",
  "artifacts": [
    {
      "id": "screen",
      "type": "react-screen",
      "path": "src/generated/Screen.tsx",
      "name": "Generated Screen"
    }
  ]
}
"#;

const ANCHORS_JSON: &str = r#"{
  "updatedAt": "",
  "artifactPath": "src/generated/Screen.tsx",
  "anchors": []
}
"#;

const WORKSPACE_SETTINGS_JSON: &str = r#"{
  "codexPath": "codex",
  "chatFirst": true,
  "defaultArtifact": "screen"
}
"#;

const WORKSPACE_PACKAGE_JSON: &str = r#"{
  "name": "designforge-workspace",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1 --port 5173",
    "build": "node ./node_modules/vite/bin/vite.js build",
    "typecheck": "node ./node_modules/typescript/bin/tsc --noEmit"
  },
  "dependencies": {
    "react": "^19.2.7",
    "react-dom": "^19.2.7"
  },
  "devDependencies": {
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "autoprefixer": "^10.4.22",
    "postcss": "^8.5.6",
    "tailwindcss": "^3.4.17",
    "typescript": "^6.0.3",
    "vite": "^8.1.3"
  }
}
"#;

const WORKSPACE_TSCONFIG: &str = r#"{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
"#;

const WORKSPACE_TAILWIND_CONFIG: &str = r#"/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};
"#;

const WORKSPACE_POSTCSS_CONFIG: &str = r#"module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
"#;

const WORKSPACE_INDEX_HTML: &str = r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DesignForge Workspace</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
"#;

const WORKSPACE_MAIN_TSX: &str = r#"import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
"#;

const WORKSPACE_APP_TSX: &str = r#"import Screen from "./generated/Screen";

export default function App() {
  return <Screen />;
}
"#;

const WORKSPACE_STYLES_CSS: &str = r#"@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: dark;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}

button,
input,
textarea,
select {
  font: inherit;
}

:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 1ms !important;
    scroll-behavior: auto !important;
    transition-duration: 1ms !important;
  }
}
"#;

const WORKSPACE_SCREEN_TSX: &str = r#"export default function Screen() {
  return (
    <main data-screen-label="Generated Screen" className="min-h-screen bg-zinc-950 px-6 py-10 text-zinc-100">
      <section className="mx-auto grid max-w-5xl gap-6">
        <p className="font-mono text-sm text-cyan-300">Codex Design workspace</p>
        <h1 className="max-w-3xl text-4xl font-semibold">Start from DESIGN.md, then shape one strong screen.</h1>
        <p className="max-w-2xl text-lg leading-8 text-zinc-300">
          The chat request updates the design system first, then generates this isolated React/Tailwind artifact.
        </p>
      </section>
    </main>
  );
}
"#;
