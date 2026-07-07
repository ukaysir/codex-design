# TAURI BACKEND KNOWLEDGE

## OVERVIEW

`src-tauri` owns the Windows desktop shell, native file/process commands, Codex runtime integration, workspace scaffolding, preview/capture flows, and handoff zip creation.

## STRUCTURE

```txt
src-tauri/
|-- Cargo.toml                 # Tauri, serde, base64, zip dependencies
|-- tauri.conf.json            # Product metadata, Vite hooks, NSIS bundle
|-- capabilities/              # Tauri permission capability
|-- icons/                     # App icons for bundle targets
`-- src/
    |-- main.rs                # Tauri command surface and native implementation
    |-- scaffold.rs            # include_str! registry for generated workspace files
    `-- scaffold/              # Template files copied into each DesignForge project
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add frontend-callable command | `src/main.rs` near existing `#[tauri::command]` group | Also register in `invoke_handler` at file end |
| Change project creation | `create_project`, `create_default_files`, `src/scaffold/` | New projects copy scaffold files |
| Change file sandboxing | `canonical_workspace`, `resolve_existing`, `resolve_for_write`, `clean_relative` | Must prevent path escape |
| Change Codex exec fallback | `run_codex_blocking`, `run_codex_with_sandbox` | Preserve Windows sandbox fallback behavior |
| Change app-server runtime | `CodexAppServerManager`, `run_codex_app_server_blocking`, RPC helpers | Keep persistent process and workspace-thread map coherent |
| Change verification | `verify_workspace_blocking`, `run_node_tool`, package tool helpers | Workspace dependency install may run first |
| Change preview/capture | `start_preview`, `capture_screenshot_blocking`, `capture_console_blocking` | Browser discovery is Windows-path aware |
| Change export package | `export_handoff_blocking`, `handoff_files`, zip helpers | Include evidence manifests and assets only when present |

## CONVENTIONS

- Tauri structs serialize with `#[serde(rename_all = "camelCase")]`; keep TypeScript types in `src/types.ts` aligned.
- Long-running commands use `run_blocking` so the Tauri command thread is not held.
- Workspace paths must go through canonicalization and relative-path cleaning before read/write/delete.
- Windows node/npm discovery does not assume inherited PATH; `node_exe_path`, `npm_cli_path`, and `package_command` are deliberate.
- Codex prompts are file-backed to avoid Windows `os error 206`.
- `default_codex_sandbox()` may return `danger-full-access` on Windows; do not remove fallback without testing process launch.
- Template text belongs in `src/scaffold/` and is included through `src/scaffold.rs`, not pasted into `main.rs`.

## ANTI-PATTERNS

- Do not weaken path containment checks for workspace file commands.
- Do not run long Codex, build, preview, capture, or export operations directly on the async command thread.
- Do not kill the app-server after each successful turn; reuse per-workspace threads.
- Do not overwrite generated project files during project creation unless the reset command explicitly does so.
- Do not edit `src/scaffold/AGENTS.md` as if it governs this parent repo; it governs generated child workspaces.
- Do not add PowerShell archive dependency for handoff zips; backend zip creation is native Rust.

## VERIFY

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run tauri:build
```

For command behavior changes, manually drive the corresponding desktop action from DesignForge, not only unit/build checks.
