#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    env, fs,
    io::{BufRead, BufReader, Read, Seek, Write},
    net::TcpStream,
    path::{Component, Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceInfo {
    path: String,
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectInfo {
    path: String,
    name: String,
    created_at: String,
    updated_at: String,
    chat_count: usize,
    run_count: usize,
    last_message: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFile {
    relative_path: String,
    is_directory: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandResult {
    success: bool,
    code: Option<i32>,
    stdout: String,
    stderr: String,
    session_id: Option<String>,
    used_resume: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CodexAppServerEvent {
    run_id: String,
    method: String,
    params: Value,
    delta: Option<String>,
    thread_id: Option<String>,
    turn_id: Option<String>,
}

#[derive(Default)]
struct CodexAppServerRunState {
    thread_id: Option<String>,
    turn_id: Option<String>,
    response_text: String,
    completed: bool,
    failed_message: Option<String>,
    event_count: usize,
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
fn create_project(project_root_path: String, name: Option<String>) -> Result<ProjectInfo, String> {
    let root = PathBuf::from(clean_input(&project_root_path));
    fs::create_dir_all(&root).map_err(|error| format!("Could not create project root: {error}"))?;
    let root = fs::canonicalize(root).map_err(|error| format!("Could not resolve project root: {error}"))?;
    if !root.is_dir() {
        return Err("Project root path is not a directory.".into());
    }

    let display_name = clean_project_name(name.as_deref());
    let slug = slugify_project_name(&display_name);
    let project_dir = unique_project_dir(&root, &slug);
    fs::create_dir_all(&project_dir).map_err(|error| format!("Could not create project directory: {error}"))?;
    create_default_files(&project_dir)?;
    write_project_manifest(&project_dir, &display_name)?;
    project_info(project_dir)
}

#[tauri::command]
fn list_projects(project_root_path: String) -> Result<Vec<ProjectInfo>, String> {
    let root = PathBuf::from(clean_input(&project_root_path));
    fs::create_dir_all(&root).map_err(|error| format!("Could not create project root: {error}"))?;
    let root = fs::canonicalize(root).map_err(|error| format!("Could not resolve project root: {error}"))?;
    if !root.is_dir() {
        return Err("Project root path is not a directory.".into());
    }

    let mut projects: Vec<(u64, ProjectInfo)> = Vec::new();
    if is_design_project_dir(&root) {
        if let Ok(info) = project_info(root.clone()) {
            projects.push((seconds_since_epoch(project_updated_time(&root)), info));
        }
    }

    for entry in fs::read_dir(&root).map_err(|error| format!("Could not list project root: {error}"))? {
        let entry = entry.map_err(|error| format!("Could not read project entry: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Could not read project entry type: {error}"))?;
        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if !is_design_project_dir(&path) {
            continue;
        }
        if let Ok(info) = project_info(path.clone()) {
            projects.push((seconds_since_epoch(project_updated_time(&path)), info));
        }
    }

    projects.sort_by_key(|item| std::cmp::Reverse(item.0));
    Ok(projects.into_iter().map(|(_, info)| info).collect())
}

#[tauri::command]
fn reset_workspace_design_state(workspace_path: String) -> Result<(), String> {
    let root = canonical_workspace(&workspace_path)?;
    write_starter_file(root.join("DESIGN.md"), DESIGN_MD)?;
    write_starter_file(root.join("src/generated/Screen.tsx"), WORKSPACE_SCREEN_TSX)?;
    write_starter_file(root.join("src/styles.css"), WORKSPACE_STYLES_CSS)?;
    write_starter_file(root.join(".designforge/artifacts.json"), ARTIFACTS_JSON)?;
    write_starter_file(root.join(".designforge/anchors.json"), ANCHORS_JSON)?;
    write_starter_file(root.join(".designforge/comments.jsonl"), "")?;
    write_starter_file(root.join(".designforge/runs.jsonl"), "")?;
    write_starter_file(root.join(".designforge/chat.jsonl"), "")?;
    write_starter_file(root.join(".designforge/activity.jsonl"), "")?;
    write_starter_file(root.join(".designforge/attachments.json"), "[]")?;

    for relative_path in [
        ".designforge/brief.json",
        ".designforge/clarification.json",
        ".designforge/codex-session.json",
        ".designforge/context.json",
        ".designforge/critique.json",
        ".designforge/preview.json",
        ".designforge/tokens.json",
        ".designforge/static-check.json",
        ".designforge/quality-audit.json",
        ".designforge/generated-images.json",
        ".designforge/codex-prompts/latest.md",
        "prompts/latest.md",
        "prompts/clarification-latest.md",
        "prompts/image-latest.md",
        "prompts/repair-latest.md",
        "prompts/critique-latest.md",
        "prompts/quality-latest.md",
        "outputs/screenshots/latest.png",
        "outputs/console/latest.json",
        "outputs/handoff/README.md",
        "outputs/exports/designforge-handoff.zip",
    ] {
        remove_workspace_file_if_exists(&root, relative_path)?;
    }

    Ok(())
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
fn write_binary_file(
    workspace_path: String,
    relative_path: String,
    base64_content: String,
) -> Result<(), String> {
    let root = canonical_workspace(&workspace_path)?;
    let path = resolve_for_write(&root, &relative_path)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_content.trim())
        .map_err(|error| format!("Could not decode binary file content: {error}"))?;
    fs::write(path, bytes).map_err(|error| format!("Could not write binary file: {error}"))
}

#[tauri::command]
fn check_codex(codex_path: String) -> Result<CommandResult, String> {
    run_command(Command::new(tool_path(&codex_path)).arg("--version"))
}

#[tauri::command]
async fn run_codex(
    workspace_path: String,
    codex_path: String,
    prompt: String,
    resume_session_id: Option<String>,
    model: Option<String>,
    effort: Option<String>,
) -> Result<CommandResult, String> {
    run_blocking(move || {
        run_codex_blocking(
            workspace_path,
            codex_path,
            prompt,
            resume_session_id,
            model,
            effort,
        )
    })
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn run_codex_app_server(
    app: tauri::AppHandle,
    workspace_path: String,
    codex_path: String,
    prompt: String,
    resume_session_id: Option<String>,
    run_id: String,
    model: Option<String>,
    effort: Option<String>,
) -> Result<CommandResult, String> {
    run_blocking(move || {
        run_codex_app_server_blocking(
            app,
            workspace_path,
            codex_path,
            prompt,
            resume_session_id,
            run_id,
            model,
            effort,
        )
    })
    .await
}

fn run_codex_blocking(
    workspace_path: String,
    codex_path: String,
    prompt: String,
    resume_session_id: Option<String>,
    model: Option<String>,
    effort: Option<String>,
) -> Result<CommandResult, String> {
    if prompt.trim().is_empty() {
        return Err("Prompt is empty.".into());
    }

    let root = canonical_workspace(&workspace_path)?;
    let sandbox = default_codex_sandbox();
    // TODO: add streaming output and a stricter process policy before broad automation.
    let result = run_codex_with_sandbox(
        &root,
        &codex_path,
        &prompt,
        sandbox,
        resume_session_id.as_deref(),
        model.as_deref(),
        effort.as_deref(),
    )?;
    let result = if resume_session_id.is_some() && !result.success {
        let fallback = run_codex_with_sandbox(
            &root,
            &codex_path,
            &prompt,
            sandbox,
            None,
            model.as_deref(),
            effort.as_deref(),
        )?;
        merge_resume_fallback_result(result, fallback)
    } else {
        result
    };
    if sandbox != "danger-full-access" && should_retry_codex_without_windows_sandbox(&result) {
        let fallback = run_codex_with_sandbox(
            &root,
            &codex_path,
            &prompt,
            "danger-full-access",
            resume_session_id.as_deref(),
            model.as_deref(),
            effort.as_deref(),
        )?;
        let fallback = if resume_session_id.is_some() && !fallback.success {
            let fresh = run_codex_with_sandbox(
                &root,
                &codex_path,
                &prompt,
                "danger-full-access",
                None,
                model.as_deref(),
                effort.as_deref(),
            )?;
            merge_resume_fallback_result(fallback, fresh)
        } else {
            fallback
        };
        return Ok(CommandResult {
            success: fallback.success,
            code: fallback.code,
            stdout: format!(
                "workspace-write sandbox failed on Windows; retried with danger-full-access.\n\n{}",
                fallback.stdout
            ),
            stderr: format!(
                "{}\n\nworkspace-write sandbox stderr:\n{}",
                fallback.stderr, result.stderr
            ),
            session_id: fallback.session_id,
            used_resume: fallback.used_resume,
        });
    }
    Ok(result)
}

fn default_codex_sandbox() -> &'static str {
    if cfg!(windows) {
        "danger-full-access"
    } else {
        "workspace-write"
    }
}

fn powershell_7_path() -> Option<String> {
    if !cfg!(windows) {
        return None;
    }

    let mut candidates = Vec::new();
    if let Ok(value) = env::var("DESIGNFORGE_PWSH_PATH") {
        candidates.push(PathBuf::from(value));
    }
    if let Some(user_profile) = env::var_os("USERPROFILE") {
        candidates
            .push(PathBuf::from(user_profile).join("Downloads/PowerShell-7.6.2-win-x64/pwsh.exe"));
    }
    if let Some(program_files) = env::var_os("ProgramFiles") {
        candidates.push(PathBuf::from(program_files).join("PowerShell/7/pwsh.exe"));
    }
    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        candidates.push(
            PathBuf::from(local_app_data)
                .join("Microsoft/WinGet/Packages/Microsoft.PowerShell_Microsoft.Winget.Source_8wekyb3d8bbwe/pwsh.exe"),
        );
    }
    if let Some(path) = env::var_os("PATH") {
        candidates.extend(env::split_paths(&path).map(|dir| dir.join("pwsh.exe")));
    }

    candidates
        .into_iter()
        .find(|candidate| is_usable_powershell_7(candidate))
        .map(|path| path.to_string_lossy().to_string())
}

fn is_usable_powershell_7(path: &Path) -> bool {
    if !path.exists() {
        return false;
    }
    let Ok(output) = Command::new(path)
        .arg("-NoLogo")
        .arg("-NoProfile")
        .arg("-Command")
        .arg("$PSVersionTable.PSVersion.Major")
        .output()
    else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<u32>()
        .is_ok_and(|major| major >= 7)
}

fn prepend_command_path(command: &mut Command, executable_path: &str) {
    let Some(parent) = Path::new(executable_path).parent() else {
        return;
    };
    let Some(existing_path) = env::var_os("PATH") else {
        command.env("PATH", parent.as_os_str());
        return;
    };
    let mut paths = vec![parent.to_path_buf()];
    paths.extend(env::split_paths(&existing_path));
    if let Ok(joined) = env::join_paths(paths) {
        command.env("PATH", joined);
    }
}

fn toml_string(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

fn run_codex_with_sandbox(
    root: &Path,
    codex_path: &str,
    prompt: &str,
    sandbox: &str,
    resume_session_id: Option<&str>,
    model: Option<&str>,
    effort: Option<&str>,
) -> Result<CommandResult, String> {
    let prompt_file = write_codex_prompt_file(root, prompt)?;
    let prompt_instruction = format!(
        "Read the full task from this workspace file and follow it exactly: {}",
        prompt_file
    );
    let mut command = Command::new(tool_path(codex_path));
    command
        .current_dir(root)
        .arg("exec")
        .arg("-C")
        .arg(root)
        .arg("--sandbox")
        .arg(sandbox)
        .arg("--skip-git-repo-check")
        .arg("--color")
        .arg("never");
    if let Some(model) = clean_optional_cli_value(model) {
        command.arg("--model").arg(model);
    }
    if let Some(effort) = clean_optional_cli_value(effort) {
        command
            .arg("-c")
            .arg(format!("model_reasoning_effort={}", toml_string(effort)));
    }
    if let Some(pwsh_path) = powershell_7_path() {
        prepend_command_path(&mut command, &pwsh_path);
        command
            .arg("-c")
            .arg(format!("windows.shell_path={}", toml_string(&pwsh_path)));
    }
    if let Some(session_id) = resume_session_id {
        command.arg("resume").arg(session_id);
    }
    command.arg(prompt_instruction);
    let mut result = run_command(&mut command)?;
    let output = format!("{}\n{}", result.stdout, result.stderr);
    result.session_id = extract_codex_session_id(&output);
    result.used_resume = resume_session_id.is_some();
    Ok(result)
}

fn clean_optional_cli_value(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

#[allow(clippy::too_many_arguments)]
fn run_codex_app_server_blocking(
    app: tauri::AppHandle,
    workspace_path: String,
    codex_path: String,
    prompt: String,
    resume_session_id: Option<String>,
    run_id: String,
    model: Option<String>,
    effort: Option<String>,
) -> Result<CommandResult, String> {
    if prompt.trim().is_empty() {
        return Err("Prompt is empty.".into());
    }

    let root = canonical_workspace(&workspace_path)?;
    let prompt_file = write_codex_prompt_file(&root, &prompt)?;
    let prompt_instruction = format!(
        "Read the full task from this workspace file and follow it exactly: {}",
        prompt_file
    );
    let root_string = root.to_string_lossy().to_string();
    let sandbox = default_codex_sandbox();
    let model = clean_optional_cli_value(model.as_deref()).map(str::to_string);
    let effort = clean_optional_cli_value(effort.as_deref()).map(str::to_string);

    let mut command = Command::new(tool_path(&codex_path));
    command
        .current_dir(&root)
        .arg("app-server")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(pwsh_path) = powershell_7_path() {
        prepend_command_path(&mut command, &pwsh_path);
        command
            .arg("-c")
            .arg(format!("windows.shell_path={}", toml_string(&pwsh_path)));
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start Codex app-server: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not capture Codex app-server stdout.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Could not capture Codex app-server stderr.".to_string())?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Could not open Codex app-server stdin.".to_string())?;

    let stderr_buffer = Arc::new(Mutex::new(String::new()));
    let stderr_target = Arc::clone(&stderr_buffer);
    thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut buffer = String::new();
        let _ = reader.read_to_string(&mut buffer);
        if !buffer.is_empty() {
            if let Ok(mut target) = stderr_target.lock() {
                target.push_str(&buffer);
            }
        }
    });

    let mut reader = BufReader::new(stdout);
    let mut state = CodexAppServerRunState::default();
    let mut next_id = 1_u64;

    emit_codex_status(&app, &run_id, "Codex app-server starting");
    codex_rpc_request(
        &mut reader,
        &mut stdin,
        &mut next_id,
        "initialize",
        json!({
            "clientInfo": {
                "name": "designforge",
                "title": "DesignForge",
                "version": env!("CARGO_PKG_VERSION")
            },
            "capabilities": { "experimentalApi": true }
        }),
        &app,
        &run_id,
        &mut state,
    )?;
    write_json_line(&mut stdin, &json!({ "method": "initialized", "params": {} }))?;

    let mut used_resume = false;
    let thread_result = if let Some(session_id) = resume_session_id.as_deref() {
        used_resume = true;
        let mut params = codex_thread_params(&root_string, sandbox, model.as_deref());
        params["threadId"] = json!(session_id);
        match codex_rpc_request(
            &mut reader,
            &mut stdin,
            &mut next_id,
            "thread/resume",
            params,
            &app,
            &run_id,
            &mut state,
        ) {
            Ok(result) => result,
            Err(error) => {
                used_resume = false;
                emit_codex_status(
                    &app,
                    &run_id,
                    &format!("Codex app-server resume failed; starting a fresh thread: {error}"),
                );
                codex_rpc_request(
                    &mut reader,
                    &mut stdin,
                    &mut next_id,
                    "thread/start",
                    codex_thread_params(&root_string, sandbox, model.as_deref()),
                    &app,
                    &run_id,
                    &mut state,
                )?
            }
        }
    } else {
        codex_rpc_request(
            &mut reader,
            &mut stdin,
            &mut next_id,
            "thread/start",
            codex_thread_params(&root_string, sandbox, model.as_deref()),
            &app,
            &run_id,
            &mut state,
        )?
    };

    state.thread_id =
        json_path_string(&thread_result, &["thread", "id"]).or_else(|| state.thread_id.clone());
    let Some(thread_id) = state.thread_id.clone() else {
        let _ = child.kill();
        return Err("Codex app-server did not return a thread id.".into());
    };
    emit_codex_status(
        &app,
        &run_id,
        &format!("Codex app-server thread {}", short_for_log(&thread_id)),
    );

    let turn_result = codex_rpc_request(
        &mut reader,
        &mut stdin,
        &mut next_id,
        "turn/start",
        codex_turn_params(
            &root_string,
            &thread_id,
            &prompt_instruction,
            model.as_deref(),
            effort.as_deref(),
        ),
        &app,
        &run_id,
        &mut state,
    )?;
    state.turn_id =
        json_path_string(&turn_result, &["turn", "id"]).or_else(|| state.turn_id.clone());

    while !state.completed && state.failed_message.is_none() {
        let message = codex_read_json_message(&mut reader)?;
        handle_codex_app_server_message(&message, &app, &run_id, &mut state);
    }

    let _ = child.kill();
    let _ = child.wait();
    let stderr_text = stderr_buffer
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();
    let stdout = format!(
        "Codex app-server thread: {}\nCodex app-server turn: {}\nEvents: {}\n\n{}",
        state.thread_id.as_deref().unwrap_or("unknown"),
        state.turn_id.as_deref().unwrap_or("unknown"),
        state.event_count,
        state.response_text.trim()
    )
    .trim()
    .to_string();

    if let Some(error) = state.failed_message {
        return Ok(CommandResult {
            success: false,
            code: Some(1),
            stdout,
            stderr: format!("{error}\n{stderr_text}").trim().to_string(),
            session_id: state.thread_id,
            used_resume,
        });
    }

    Ok(CommandResult {
        success: state.completed,
        code: Some(0),
        stdout,
        stderr: stderr_text,
        session_id: state.thread_id,
        used_resume,
    })
}

fn codex_thread_params(root: &str, sandbox: &str, model: Option<&str>) -> Value {
    let mut params = json!({
        "cwd": root,
        "sandbox": sandbox
    });
    if let Some(model) = clean_optional_cli_value(model) {
        params["model"] = json!(model);
    }
    params
}

fn codex_turn_params(
    root: &str,
    thread_id: &str,
    prompt_instruction: &str,
    model: Option<&str>,
    effort: Option<&str>,
) -> Value {
    let mut params = json!({
        "threadId": thread_id,
        "cwd": root,
        "input": [
            { "type": "text", "text": prompt_instruction }
        ]
    });
    if let Some(model) = clean_optional_cli_value(model) {
        params["model"] = json!(model);
    }
    if let Some(effort) = clean_optional_cli_value(effort) {
        params["effort"] = json!(effort);
    }
    params
}

#[allow(clippy::too_many_arguments)]
fn codex_rpc_request(
    reader: &mut BufReader<ChildStdout>,
    stdin: &mut ChildStdin,
    next_id: &mut u64,
    method: &str,
    params: Value,
    app: &tauri::AppHandle,
    run_id: &str,
    state: &mut CodexAppServerRunState,
) -> Result<Value, String> {
    let id = *next_id;
    *next_id += 1;
    write_json_line(
        stdin,
        &json!({
            "id": id,
            "method": method,
            "params": params
        }),
    )?;

    loop {
        let message = codex_read_json_message(reader)?;
        if message.get("id").and_then(Value::as_u64) == Some(id) {
            if let Some(error) = message.get("error") {
                return Err(format!(
                    "Codex app-server {method} failed: {}",
                    compact_json(error)
                ));
            }
            return Ok(message.get("result").cloned().unwrap_or(Value::Null));
        }
        handle_codex_app_server_message(&message, app, run_id, state);
        if let Some(error) = state.failed_message.as_deref() {
            return Err(error.to_string());
        }
    }
}

fn write_json_line(stdin: &mut ChildStdin, value: &Value) -> Result<(), String> {
    let line = serde_json::to_string(value)
        .map_err(|error| format!("Could not serialize Codex app-server request: {error}"))?;
    stdin
        .write_all(line.as_bytes())
        .map_err(|error| format!("Could not write Codex app-server request: {error}"))?;
    stdin
        .write_all(b"\n")
        .map_err(|error| format!("Could not finish Codex app-server request: {error}"))?;
    stdin
        .flush()
        .map_err(|error| format!("Could not flush Codex app-server request: {error}"))
}

fn codex_read_json_message(reader: &mut BufReader<ChildStdout>) -> Result<Value, String> {
    let mut line = String::new();
    let bytes = reader
        .read_line(&mut line)
        .map_err(|error| format!("Could not read Codex app-server response: {error}"))?;
    if bytes == 0 {
        return Err("Codex app-server closed stdout before the turn completed.".into());
    }
    serde_json::from_str(line.trim())
        .map_err(|error| format!("Codex app-server returned invalid JSON: {error}: {line}"))
}

fn handle_codex_app_server_message(
    message: &Value,
    app: &tauri::AppHandle,
    run_id: &str,
    state: &mut CodexAppServerRunState,
) {
    let Some(method) = message.get("method").and_then(Value::as_str) else {
        return;
    };
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    state.event_count += 1;

    let thread_id = json_path_string(&params, &["threadId"])
        .or_else(|| json_path_string(&params, &["thread", "id"]));
    let turn_id = json_path_string(&params, &["turnId"])
        .or_else(|| json_path_string(&params, &["turn", "id"]));
    if let Some(thread_id) = thread_id.clone() {
        state.thread_id = Some(thread_id);
    }
    if let Some(turn_id) = turn_id.clone() {
        state.turn_id = Some(turn_id);
    }

    let delta = if method == "item/agentMessage/delta" {
        params
            .get("delta")
            .and_then(Value::as_str)
            .map(|value| value.to_string())
    } else {
        None
    };
    if let Some(delta) = delta.as_deref() {
        state.response_text.push_str(delta);
    }

    if method == "item/completed"
        && params
            .get("item")
            .and_then(|item| item.get("type"))
            .and_then(Value::as_str)
            == Some("agentMessage")
    {
        if let Some(text) = params
            .get("item")
            .and_then(|item| item.get("text"))
            .and_then(Value::as_str)
        {
            state.response_text = text.to_string();
        }
    }

    if method == "error" {
        state.failed_message = Some(
            params
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Codex app-server emitted an error.")
                .to_string(),
        );
    }

    if method == "turn/completed" {
        state.completed = true;
        if let Some(error) = params
            .get("turn")
            .and_then(|turn| turn.get("error"))
            .filter(|error| !error.is_null())
        {
            state.failed_message = Some(format!("Codex turn completed with error: {}", compact_json(error)));
        }
    }

    let event = CodexAppServerEvent {
        run_id: run_id.to_string(),
        method: method.to_string(),
        params,
        delta,
        thread_id,
        turn_id,
    };
    let _ = app.emit("codex-app-server-event", event);
}

fn emit_codex_status(app: &tauri::AppHandle, run_id: &str, message: &str) {
    let event = CodexAppServerEvent {
        run_id: run_id.to_string(),
        method: "designforge/status".into(),
        params: json!({ "message": message }),
        delta: None,
        thread_id: None,
        turn_id: None,
    };
    let _ = app.emit("codex-app-server-event", event);
}

fn json_path_string(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_str().map(|value| value.to_string())
}

fn compact_json(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| value.to_string())
}

fn short_for_log(value: &str) -> String {
    value.chars().take(8).collect()
}

fn write_codex_prompt_file(root: &Path, prompt: &str) -> Result<String, String> {
    let dir = root.join(".designforge/codex-prompts");
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create Codex prompt folder: {error}"))?;
    let name = "latest.md";
    let full_path = dir.join(name);
    fs::write(&full_path, prompt)
        .map_err(|error| format!("Could not write Codex prompt file: {error}"))?;
    Ok(format!(".designforge/codex-prompts/{name}"))
}

fn merge_resume_fallback_result(resume: CommandResult, mut fresh: CommandResult) -> CommandResult {
    fresh.stdout = format!(
        "Codex resume failed; retried with a fresh exec session.\n\nresume stdout:\n{}\n\nfresh stdout:\n{}",
        resume.stdout, fresh.stdout
    );
    fresh.stderr = format!("{}\n\nresume stderr:\n{}", fresh.stderr, resume.stderr);
    fresh.used_resume = false;
    fresh
}

fn extract_codex_session_id(output: &str) -> Option<String> {
    for line in output.lines() {
        let lower = line.to_ascii_lowercase();
        let Some(index) = lower.find("session id:") else {
            continue;
        };
        let value = line[index + "session id:".len()..]
            .trim()
            .trim_matches(|ch: char| {
                ch == '`' || ch == '"' || ch == '\'' || ch == ',' || ch == ';'
            });
        let candidate = value.split_whitespace().next().unwrap_or("").trim();
        if is_plausible_session_id(candidate) {
            return Some(candidate.to_string());
        }
    }
    None
}

fn is_plausible_session_id(value: &str) -> bool {
    let len = value.len();
    (16..=80).contains(&len)
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
}

fn should_retry_codex_without_windows_sandbox(result: &CommandResult) -> bool {
    if result.success || !cfg!(windows) {
        return false;
    }
    let output = format!("{}\n{}", result.stdout, result.stderr);
    output.contains("CreateProcessAsUserW failed: 5")
        || output.contains("windows sandbox")
        || output.contains("sandbox launch issue")
}

#[tauri::command]
async fn verify_workspace(
    workspace_path: String,
    package_manager: String,
) -> Result<CommandResult, String> {
    run_blocking(move || verify_workspace_blocking(workspace_path, package_manager)).await
}

fn verify_workspace_blocking(
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
        session_id: None,
        used_resume: false,
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

    let mut command = node_command()?;
    let child = command
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
async fn export_handoff(workspace_path: String) -> Result<ExportInfo, String> {
    run_blocking(move || export_handoff_blocking(workspace_path)).await
}

fn export_handoff_blocking(workspace_path: String) -> Result<ExportInfo, String> {
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
    copy_dir_if_exists(&root, &stage, ".designforge/attachments")?;

    if zip_path.exists() {
        fs::remove_file(&zip_path)
            .map_err(|error| format!("Could not replace existing export: {error}"))?;
    }

    create_zip_from_directory(&stage, &zip_path)?;

    Ok(ExportInfo {
        path: shell_path(&zip_path),
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
async fn capture_screenshot(workspace_path: String, url: String) -> Result<ScreenshotInfo, String> {
    run_blocking(move || capture_screenshot_blocking(workspace_path, url)).await
}

fn capture_screenshot_blocking(
    workspace_path: String,
    url: String,
) -> Result<ScreenshotInfo, String> {
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
async fn capture_console(workspace_path: String, url: String) -> Result<ConsoleInfo, String> {
    run_blocking(move || capture_console_blocking(workspace_path, url)).await
}

fn capture_console_blocking(workspace_path: String, url: String) -> Result<ConsoleInfo, String> {
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
            create_project,
            list_projects,
            reset_workspace_design_state,
            list_workspace_files,
            read_file,
            write_file,
            write_binary_file,
            check_codex,
            run_codex,
            run_codex_app_server,
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
        session_id: None,
        used_resume: false,
    })
}

async fn run_blocking<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("Background task failed: {error}"))?
}

fn run_node_tool(root: &Path, args: &[&str]) -> Result<CommandResult, String> {
    let mut command = node_command()?;
    command.current_dir(root).args(args);
    run_command(&mut command)
}

fn label_result(label: &str, result: CommandResult) -> CommandResult {
    CommandResult {
        success: result.success,
        code: result.code,
        stdout: format!("{label} stdout:\n{}", result.stdout),
        stderr: format!("{label} stderr:\n{}", result.stderr),
        session_id: result.session_id,
        used_resume: result.used_resume,
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

fn project_info(root: PathBuf) -> Result<ProjectInfo, String> {
    if !root.is_dir() {
        return Err("Project path is not a directory.".into());
    }
    let created_at = seconds_string(project_created_time(&root));
    let updated_at = seconds_string(project_updated_time(&root));
    let chat_count = jsonl_count(root.join(".designforge/chat.jsonl"));
    let activity_count = jsonl_count(root.join(".designforge/activity.jsonl"));
    let run_count = jsonl_count(root.join(".designforge/runs.jsonl"));
    let last_message =
        last_jsonl_content(root.join(".designforge/chat.jsonl")).or_else(|| last_run_request(root.join(".designforge/runs.jsonl")));
    Ok(ProjectInfo {
        path: root.to_string_lossy().to_string(),
        name: project_display_name(&root),
        created_at,
        updated_at,
        chat_count: chat_count + activity_count,
        run_count,
        last_message,
    })
}

fn clean_project_name(value: Option<&str>) -> String {
    let trimmed = value.unwrap_or("").trim();
    if trimmed.is_empty() {
        "Untitled DesignForge Project".into()
    } else {
        trimmed.chars().take(80).collect()
    }
}

fn slugify_project_name(value: &str) -> String {
    let mut slug = String::new();
    let mut previous_dash = false;
    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
            previous_dash = false;
        } else if !previous_dash {
            slug.push('-');
            previous_dash = true;
        }
    }
    let slug = slug.trim_matches('-');
    if slug.is_empty() {
        "design-project".into()
    } else {
        slug.chars().take(48).collect()
    }
}

fn unique_project_dir(root: &Path, slug: &str) -> PathBuf {
    let timestamp = unix_seconds();
    let base = format!("{slug}-{timestamp}");
    let mut candidate = root.join(&base);
    let mut index = 2;
    while candidate.exists() {
        candidate = root.join(format!("{base}-{index}"));
        index += 1;
    }
    candidate
}

fn write_project_manifest(root: &Path, name: &str) -> Result<(), String> {
    let path = root.join(".designforge/project.json");
    let now = unix_seconds().to_string();
    let manifest = serde_json::json!({
        "name": name,
        "createdAt": now,
        "updatedAt": now
    });
    write_starter_file(
        path,
        &serde_json::to_string_pretty(&manifest)
            .map_err(|error| format!("Could not serialize project manifest: {error}"))?,
    )
}

fn is_design_project_dir(path: &Path) -> bool {
    path.join("designforge.config.json").is_file()
        || path.join("DESIGN.md").is_file()
        || path.join(".designforge/runs.jsonl").is_file()
}

fn project_display_name(root: &Path) -> String {
    for relative_path in [".designforge/project.json", "designforge.config.json"] {
        let path = root.join(relative_path);
        let Ok(raw) = fs::read_to_string(path) else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
            continue;
        };
        let Some(name) = value.get("name").and_then(|item| item.as_str()) else {
            continue;
        };
        if !name.trim().is_empty() && name != "Untitled DesignForge Project" {
            return name.trim().to_string();
        }
    }

    root.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("DesignForge Project")
        .to_string()
}

fn project_created_time(root: &Path) -> SystemTime {
    root.metadata()
        .and_then(|metadata| metadata.created().or_else(|_| metadata.modified()))
        .unwrap_or(UNIX_EPOCH)
}

fn project_updated_time(root: &Path) -> SystemTime {
    [
        ".designforge/chat.jsonl",
        ".designforge/activity.jsonl",
        ".designforge/runs.jsonl",
        ".designforge/brief.json",
        ".designforge/context.json",
        "DESIGN.md",
        "src/generated/Screen.tsx",
    ]
    .iter()
    .filter_map(|relative_path| root.join(relative_path).metadata().ok()?.modified().ok())
    .max()
    .unwrap_or_else(|| root.metadata().and_then(|metadata| metadata.modified()).unwrap_or(UNIX_EPOCH))
}

fn seconds_string(time: SystemTime) -> String {
    seconds_since_epoch(time).to_string()
}

fn seconds_since_epoch(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn jsonl_count(path: PathBuf) -> usize {
    fs::read_to_string(path)
        .map(|raw| raw.lines().filter(|line| !line.trim().is_empty()).count())
        .unwrap_or(0)
}

fn last_jsonl_content(path: PathBuf) -> Option<String> {
    let raw = fs::read_to_string(path).ok()?;
    for line in raw.lines().rev() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let value = serde_json::from_str::<serde_json::Value>(line).ok()?;
        let content = value.get("content").and_then(|item| item.as_str())?.trim();
        if !content.is_empty() {
            return Some(content.chars().take(180).collect());
        }
    }
    None
}

fn last_run_request(path: PathBuf) -> Option<String> {
    let raw = fs::read_to_string(path).ok()?;
    for line in raw.lines().rev() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let value = serde_json::from_str::<serde_json::Value>(line).ok()?;
        let request = value.get("request").and_then(|item| item.as_str())?.trim();
        if !request.is_empty() {
            return Some(request.chars().take(180).collect());
        }
    }
    None
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
    matches!(
        path.file_name().and_then(|value| value.to_str()),
        Some(".git" | "node_modules" | "target" | "dist")
    ) || is_design_project_dir(path)
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
    let mut stream = TcpStream::connect("127.0.0.1:5173")
        .map_err(|error| format!("Preview did not respond: {error}"))?;
    let timeout = Some(Duration::from_millis(750));
    let _ = stream.set_read_timeout(timeout);
    let _ = stream.set_write_timeout(timeout);
    stream
        .write_all(b"GET / HTTP/1.1\r\nHost: 127.0.0.1:5173\r\nConnection: close\r\n\r\n")
        .map_err(|error| format!("Preview health check request failed: {error}"))?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| format!("Preview health check read failed: {error}"))?;
    let status_line = response
        .lines()
        .next()
        .ok_or_else(|| "Preview health check returned an empty response.".to_string())?;
    let code = status_line
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| {
            format!("Preview health check returned an invalid status line: {status_line}")
        })?
        .parse::<i32>()
        .map_err(|_| {
            format!("Preview health check returned an invalid status code: {status_line}")
        })?;
    if (200..300).contains(&code) {
        Ok(code)
    } else {
        Err(format!("Preview responded with HTTP {code}."))
    }
}

fn ensure_workspace_dependencies(root: &Path, package_manager: &str) -> Result<(), String> {
    if root.join("node_modules/vite/bin/vite.js").exists()
        && root.join("node_modules/typescript/bin/tsc").exists()
    {
        return Ok(());
    }

    let tool = match package_manager.trim() {
        "" | "npm" => "npm",
        "pnpm" => "pnpm",
        "bun" => "bun",
        _ => return Err("Unsupported package manager.".into()),
    };

    // ponytail: install-on-preview is enough for MVP; add a dependency status UI if installs get slow.
    let output = package_command(tool)?
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

fn package_command(tool: &str) -> Result<Command, String> {
    if cfg!(windows) && tool == "npm" {
        if let Some(cli) = npm_cli_path() {
            let mut command = node_command()?;
            command.arg(cli);
            return Ok(command);
        }
    }
    Ok(Command::new(package_tool(tool)))
}

fn node_command() -> Result<Command, String> {
    if let Some(path) = node_exe_path() {
        Ok(Command::new(path))
    } else {
        Err("Node.js executable was not found. Install Node.js or add node.exe to PATH.".into())
    }
}

fn node_exe_path() -> Option<PathBuf> {
    let mut candidates = vec![PathBuf::from("node")];
    if cfg!(windows) {
        if let Some(root) = env::var_os("ProgramFiles") {
            candidates.push(PathBuf::from(root).join("nodejs/node.exe"));
        }
        if let Some(root) = env::var_os("ProgramFiles(x86)") {
            candidates.push(PathBuf::from(root).join("nodejs/node.exe"));
        }
        if let Some(root) = env::var_os("LOCALAPPDATA") {
            candidates.push(PathBuf::from(root).join("Programs/nodejs/node.exe"));
        }
    }

    candidates
        .into_iter()
        .find(|candidate| Command::new(candidate).arg("--version").output().is_ok())
}

fn package_tool(tool: &str) -> String {
    if cfg!(windows) && tool != "bun" {
        format!("{tool}.cmd")
    } else {
        tool.to_string()
    }
}

fn npm_cli_path() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(root) = env::var_os("ProgramFiles") {
        candidates.push(PathBuf::from(root).join("nodejs/node_modules/npm/bin/npm-cli.js"));
    }
    if let Some(root) = env::var_os("ProgramFiles(x86)") {
        candidates.push(PathBuf::from(root).join("nodejs/node_modules/npm/bin/npm-cli.js"));
    }
    candidates.into_iter().find(|candidate| candidate.exists())
}

fn create_default_files(root: &Path) -> Result<(), String> {
    let dirs = [
        "src/generated",
        "assets",
        "artifacts",
        "prompts",
        ".designforge",
        ".designforge/attachments",
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
    write_if_missing(root.join(".designforge/attachments.json"), "[]")?;
    write_if_missing(root.join(".designforge/comments.jsonl"), "")?;
    write_if_missing(root.join(".designforge/runs.jsonl"), "")?;
    write_if_missing(root.join(".designforge/chat.jsonl"), "")?;
    write_if_missing(root.join(".designforge/activity.jsonl"), "")?;
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
    write_starter_file(path, content)
}

fn write_starter_file(path: PathBuf, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create parent directory: {error}"))?;
    }
    fs::write(path, content).map_err(|error| format!("Could not write starter file: {error}"))
}

fn remove_workspace_file_if_exists(root: &Path, relative_path: &str) -> Result<(), String> {
    let full = root.join(clean_relative(relative_path)?);
    if !full.exists() {
        return Ok(());
    }
    let canonical = fs::canonicalize(&full)
        .map_err(|error| format!("Could not resolve reset file: {error}"))?;
    if !canonical.starts_with(root) {
        return Err("Reset target is outside the workspace.".into());
    }
    if canonical.is_file() {
        fs::remove_file(&canonical)
            .map_err(|error| format!("Could not remove reset file {relative_path}: {error}"))?;
    }
    Ok(())
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
        "prompts/clarification-latest.md",
        "prompts/repair-latest.md",
        "prompts/critique-latest.md",
        "prompts/quality-latest.md",
        "outputs/screenshots/latest.png",
        "outputs/console/latest.json",
        "outputs/handoff/README.md",
        ".designforge/project.json",
        ".designforge/artifacts.json",
        ".designforge/anchors.json",
        ".designforge/attachments.json",
        ".designforge/clarification.json",
        ".designforge/brief.json",
        ".designforge/context.json",
        ".designforge/tokens.json",
        ".designforge/static-check.json",
        ".designforge/chat.jsonl",
        ".designforge/activity.jsonl",
        ".designforge/comments.jsonl",
        ".designforge/critique.json",
        ".designforge/quality-audit.json",
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

fn copy_dir_if_exists(root: &Path, stage: &Path, relative_path: &str) -> Result<(), String> {
    let source = root.join(clean_relative(relative_path)?);
    if !source.exists() {
        return Ok(());
    }
    if !source.is_dir() {
        return Err(format!("Export source is not a directory: {relative_path}"));
    }
    let target = stage.join(clean_relative(relative_path)?);
    copy_dir_recursive(&source, &target)
}

fn copy_dir_recursive(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|error| format!("Could not create export directory: {error}"))?;
    for entry in fs::read_dir(source).map_err(|error| format!("Could not read export directory: {error}"))? {
        let entry = entry.map_err(|error| format!("Could not read export directory entry: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Could not inspect export directory entry: {error}"))?;
        if file_type.is_symlink() {
            continue;
        }
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&source_path, &target_path)?;
        } else if file_type.is_file() {
            fs::copy(&source_path, &target_path)
                .map_err(|error| format!("Could not copy export attachment: {error}"))?;
        }
    }
    Ok(())
}

fn create_zip_from_directory(source_dir: &Path, zip_path: &Path) -> Result<(), String> {
    let file = fs::File::create(zip_path)
        .map_err(|error| format!("Could not create handoff zip: {error}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    add_directory_to_zip(&mut zip, source_dir, source_dir, options)?;
    zip.finish()
        .map_err(|error| format!("Could not finish handoff zip: {error}"))?;
    Ok(())
}

fn add_directory_to_zip<W: Write + Seek>(
    zip: &mut zip::ZipWriter<W>,
    base_dir: &Path,
    dir: &Path,
    options: zip::write::SimpleFileOptions,
) -> Result<(), String> {
    for entry in
        fs::read_dir(dir).map_err(|error| format!("Could not read export folder: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Could not read export entry: {error}"))?;
        let path = entry.path();
        let name = zip_entry_name(base_dir, &path)?;
        if path.is_dir() {
            zip.add_directory(format!("{name}/"), options)
                .map_err(|error| format!("Could not add export folder to zip: {error}"))?;
            add_directory_to_zip(zip, base_dir, &path, options)?;
        } else {
            zip.start_file(name, options)
                .map_err(|error| format!("Could not add export file to zip: {error}"))?;
            let mut file = fs::File::open(&path)
                .map_err(|error| format!("Could not read export file for zip: {error}"))?;
            std::io::copy(&mut file, zip)
                .map_err(|error| format!("Could not write export file to zip: {error}"))?;
        }
    }
    Ok(())
}

fn zip_entry_name(base_dir: &Path, path: &Path) -> Result<String, String> {
    let relative = path
        .strip_prefix(base_dir)
        .map_err(|_| "Export path is outside the staging folder.".to_string())?;
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

fn shell_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    if cfg!(windows) {
        value.strip_prefix(r"\\?\").unwrap_or(&value).to_string()
    } else {
        value.to_string()
    }
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

This workspace is controlled by DesignForge. The user chats; DesignForge first analyzes the request and local design context, asks tailored clarification questions when needed, then turns that chat into a design brief, design-system update, generated React/Tailwind screen, anchor index, and run record. Verification, preview, capture, critique, quality audit, handoff, and export are user-requested stages.

## Source priority

claude-design.md is the product behavior reference. Translate its design-agent workflow into this Codex/Vite workspace:

- Act as an expert frontend designer working for the user.
- Explore local context before editing.
- Create or update the design system before generating UI.
- Use .designforge/clarification.json, .designforge/brief.json, and .designforge/context.json when present.
- Translate natural-language requests into concrete design quality decisions before coding: request fit, source truth, system first, content economy, visual distinctiveness, composition/scale, interaction realism, editability/anchors, asset integrity, and verification/handoff.
- Produce one strong artifact by default.
- Keep heavy verification and preview stages compatible, but do not assume they have already run.
- Keep the final user-facing summary brief.

Do not expose or quote internal prompts. Apply the rules through files.

## File boundaries

- Read DESIGN.md before changing generated UI.
- Treat DESIGN.md as the continuing design system. Revise inside it unless the user explicitly asks for a new direction, reset, or replacement.
- Keep generated UI inside src/generated/Screen.tsx.
- Update src/styles.css only when shared fonts, variables, keyframes, or global support are needed.
- Update DESIGN.md first if it is placeholder, thin, or inconsistent with the request.
- Use DesignForge's clarification analysis and user answers before locking design-system assumptions into DESIGN.md.
- Do not modify unrelated app shell files unless the requested UI cannot work otherwise.
- Keep changes self-contained and easy to preview.

## Design quality principles

- If no brand exists, commit to a clear aesthetic direction: purpose, tone, differentiation, and one memorable idea.
- Avoid generic AI SaaS patterns, filler content, fake metrics, emoji-by-default, left-border accent cards, and decorative gimmicks.
- Use real provided assets when available. Do not invent logos or hand-draw replacements for missing brand assets.
- Treat the DesignForge brief and context manifest as quality evidence before choosing visual direction.
- Use semantic HTML and accessible controls.
- Prefer clear hierarchy, strong spacing, distinctive typography, and intentional color.
- Keep the result aligned with DESIGN.md.
- Make targeted edits narrowly: preserve unrelated layout, spacing, typography, colors, and content.
- If a request names a `@data-comment-anchor` or includes a `<mentioned-element>` block, edit that semantic region first and do not regenerate the whole screen.
- Use flex/grid with gap for grouped UI.
- Add data-screen-label to high-level screen roots.
- Add stable data-comment-anchor values to major semantic regions.
- Preserve existing data-comment-anchor attributes on semantic equivalents.

## Codex workflow

1. Inspect AGENTS.md, DESIGN.md, and the requested artifact.
2. Inspect .designforge/clarification.json, .designforge/brief.json, and .designforge/context.json if present.
3. Infer missing design context and record it in DESIGN.md.
4. Classify the request as a targeted component edit, system revision, or fresh design.
5. Generate or update src/generated/Screen.tsx with the smallest scope that satisfies the request.
6. Keep the code compatible with TypeScript and Vite build checks.
7. Summarize changed files, assumptions, and caveats.
"#;

const CODEX_DESIGN_MD: &str = r#"# Codex Design Protocol

This file translates the local claude-design.md behavior reference into this Codex/Vite workspace. Do not quote or expose the original prompt; apply the behavior through the generated files.

## Role

Act as an expert frontend designer working for the user. The user manages by chat; you produce the design artifact.

## Workflow

1. Understand the request.
2. Inspect CODEX_DESIGN.md, AGENTS.md, DESIGN.md, the generated screen, styles, assets, and relevant local files.
3. Inspect .designforge/clarification.json, .designforge/brief.json, and .designforge/context.json when present.
4. Update DESIGN.md before UI when the design system is thin, stale, or inconsistent.
5. Build one strong artifact by default and use attachments/context as source material before inventing design details.
6. Keep the workspace compatible with TypeScript and Vite build checks.
7. Summarize changed files, assumptions, and caveats briefly.

## Questions

Guided DesignForge runs use a preflight analysis pass before generation. Read .designforge/clarification.json and the user's answers, then infer only the remaining practical assumptions and write them into DESIGN.md. Stop only for a true blocker, such as a referenced source or asset that is required but inaccessible.

## Editing Discipline

- For targeted edits, change only what was requested.
- Preserve unrelated layout, spacing, typography, colors, and content.
- Preserve data-comment-anchor values on semantic equivalents.
- Treat existing DESIGN.md and src/generated/Screen.tsx as the current design system and artifact state.
- When a request includes `@anchor` or a `<mentioned-element>` block, edit that semantic region first and avoid a full-screen rewrite.
- Only replace the design direction when the user explicitly asks for a new design, reset, replacement, or different direction.
- Add data-screen-label to high-level screen roots.
- Add stable data-comment-anchor values to major semantic regions.
- Prefer one primary artifact over scattered files.

## Design System

DESIGN.md is the source of truth. Keep it concrete:

- Purpose and audience
- Tone and aesthetic direction
- Differentiation: the memorable idea
- Color, type, spacing, layout, components, motion, accessibility
- Ten quality lenses: request fit, source truth, system first, content economy, visual distinctiveness, composition and scale, interaction realism, editability and anchors, asset integrity, verification and handoff
- Content rules and assumptions
- Component inventory and stable anchor map
- Revision notes for future edits
- Verification caveats
- Quality bar and unresolved design questions

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

## Quality Audit

When DesignForge asks for a quality audit, read prompts/quality-latest.md and .designforge/quality-audit.json. Improve only clear quality failures, preserve anchors, and keep verification compatibility. If the design is already strong, write a no-change verdict.
"#;

const DESIGN_MD: &str = r#"# Design System

## Source Priority

claude-design.md is the primary behavior reference, translated here for a local React/Tailwind/Vite workspace.

## Request

Pending first chat request. DesignForge will infer product identity and design direction automatically.

## Assumptions

- The user expects DesignForge to analyze the request and existing design context before asking tailored questions.
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

## Quality Bar

- Strong hierarchy: the primary message and action are obvious within five seconds.
- Specific aesthetic direction: the design should not read like a generic AI SaaS template.
- Useful content only: every section earns its place.
- System continuity: repeated controls, cards, spacing, type, and tone follow the same vocabulary.
- Implementation fidelity: responsive constraints, readable text, visible focus, and accessible controls.

## Design Quality Lenses

1. Request fit: identify artifact type, fidelity, audience, constraints, and option count.
2. Source truth: inspect assets, code, design systems, screenshots, and prior chat before inventing visual rules.
3. System first: lock purpose, tone, differentiation, typography, color, spacing, components, motion, and content rules before broad UI changes.
4. Content economy: every section earns its place; no filler, fake metrics, or unrequested material.
5. Visual distinctiveness: commit to a memorable aesthetic direction and avoid generic AI defaults.
6. Composition and scale: choose layout density, hierarchy, viewport, responsive behavior, and type scale intentionally.
7. Interaction realism: define hover, focus, active, loading, empty, error, validation, and navigation states when relevant.
8. Editability and anchors: preserve targeted edits, stable data-comment-anchor values, literal text, and semantic regions.
9. Asset integrity: use real provided assets, do not invent logos/icons, and avoid copyrighted recreation.
10. Verification and handoff: keep output previewable, record assumptions/caveats, and document exact implementation details.

## Interaction and State Model

- Define hover, active, focus, loading, empty, error, success, and disabled states when the surface implies product interaction.
- Prototype enough behavior to make the generated result feel real without making the code difficult to revise.
- Use motion for comprehension, rhythm, or state change and respect reduced-motion preferences.

## Responsive Rules

- Name the primary viewport and any fixed canvas requirement before coding.
- Ensure text, controls, and repeated items fit at desktop and narrower widths.
- Use stable flex/grid constraints, explicit gaps, and intentional density.

## Asset and Source Policy

- Use provided assets, code, or design-system evidence as source of truth.
- Do not invent logos, fake icons, fake metrics, or copyrighted UI details.
- If assets are missing, record assumptions and use neutral placeholders.

## Editability and Anchors

- Keep user-visible copy literal and directly editable where practical.
- Preserve existing data-comment-anchor values and add stable anchors for major semantic regions.
- For targeted edits, change only the requested region and preserve unrelated layout, spacing, type, colors, and copy.

## Component Inventory

Track stable semantic regions and keep them aligned with `data-comment-anchor` values in `src/generated/Screen.tsx`.

- navigation:
- hero:
- primary-action:
- feature-list:
- preview:
- footer:

## Revision Rules

- Continue inside this design system unless the user explicitly asks for a new direction.
- For a component-level request, edit only the matching anchor's semantic region.
- Preserve unrelated layout, spacing, typography, color, copy, and anchor ids.
- Record meaningful system changes here so future requests build on the same foundation.

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
  "designClarification": ".designforge/clarification.json",
  "designBrief": ".designforge/brief.json",
  "designContext": ".designforge/context.json",
  "qualityAudit": ".designforge/quality-audit.json",
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

const WORKSPACE_APP_TSX: &str = r##"import { useEffect } from "react";
import Screen from "./generated/Screen";

function closestAnchor(target: EventTarget | null) {
  return target instanceof Element ? target.closest("[data-comment-anchor]") : null;
}

function targetElement(target: EventTarget | null, anchor: Element) {
  return target instanceof Element && anchor.contains(target) ? target : anchor;
}

function siblingIndex(element: Element) {
  const siblings = Array.from(element.parentElement?.children ?? []).filter((item) => item.tagName === element.tagName);
  const index = siblings.indexOf(element);
  return siblings.length > 1 && index >= 0 ? ":nth-of-type(" + (index + 1) + ")" : "";
}

function elementPath(element: Element) {
  const path: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.body && path.length < 8) {
    const anchor = current.getAttribute("data-comment-anchor");
    const screen = current.getAttribute("data-screen-label");
    const id = current.id ? "#" + current.id : "";
    const classes = (current.getAttribute("class") || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((name) => "." + name.replace(/[^a-zA-Z0-9_-]/g, ""))
      .join("");
    path.unshift(
      current.tagName.toLowerCase() +
        id +
        classes +
        siblingIndex(current) +
        (screen ? '[data-screen-label="' + screen + '"]' : "") +
        (anchor ? '[data-comment-anchor="' + anchor + '"]' : ""),
    );
    current = current.parentElement;
  }
  return path;
}

function compactText(element: Element) {
  return (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 280);
}

function DesignForgeSelectionBridge() {
  useEffect(() => {
    const enabled = new URLSearchParams(window.location.search).get("designforgeSelect") === "1";
    if (!enabled) return;

    document.documentElement.setAttribute("data-designforge-select", "1");

    const style = document.createElement("style");
    style.id = "designforge-selection-style";
    style.textContent = [
      'html[data-designforge-select="1"] [data-comment-anchor], html[data-designforge-select="1"] [data-comment-anchor] * { cursor: crosshair; }',
      'html[data-designforge-select="1"] [data-comment-anchor] { outline: 2px solid rgba(34, 211, 238, 0.22); outline-offset: 2px; }',
      'html[data-designforge-select="1"] [data-comment-anchor] *:hover { outline: 2px solid rgba(190, 242, 100, 0.86); outline-offset: 2px; }',
      'html[data-designforge-select="1"] [data-designforge-selected="true"] { outline: 3px solid #bef264 !important; outline-offset: 3px; }',
    ].join("\n");
    document.head.appendChild(style);

    let selected: Element | null = null;

    function handleClick(event: MouseEvent) {
      const anchor = closestAnchor(event.target);
      if (!anchor) return;
      const element = targetElement(event.target, anchor);

      event.preventDefault();
      event.stopPropagation();

      if (selected) selected.removeAttribute("data-designforge-selected");
      selected = element;
      selected.setAttribute("data-designforge-selected", "true");

      const anchorId = anchor.getAttribute("data-comment-anchor") || "";
      const screenLabel =
        anchor.closest("[data-screen-label]")?.getAttribute("data-screen-label") || "Generated Screen";
      const text = compactText(element);
      const anchorText = compactText(anchor);

      window.parent.postMessage(
        {
          source: "designforge-preview-select",
          anchorId,
          screenLabel,
          tagName: element.tagName.toLowerCase(),
          anchorTagName: anchor.tagName.toLowerCase(),
          text,
          anchorText,
          className: element.getAttribute("class") || "",
          path: elementPath(element),
          anchorPath: elementPath(anchor),
        },
        "*",
      );
    }

    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
      document.documentElement.removeAttribute("data-designforge-select");
      style.remove();
      if (selected) selected.removeAttribute("data-designforge-selected");
    };
  }, []);

  return null;
}

export default function App() {
  return (
    <>
      <DesignForgeSelectionBridge />
      <Screen />
    </>
  );
}
"##;

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
