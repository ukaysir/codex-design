# DesignForge

DesignForge is a local Windows desktop scaffold for a Codex-powered UI generation workflow. The current MVP is chat-first: the user types a design request, and the app automatically creates or opens a workspace, seeds `DESIGN.md` from the `claude-design.md` workflow, writes a structured prompt, runs Codex, verifies the generated workspace, and opens a preview.

## Current MVP

- Tauri v2 app shell with React, TypeScript, Vite, and Tailwind CSS
- Chat-first desktop tool layout with automatic pipeline status and persistent logs
- Workspace create/open flow
- Starter workspace file generation
- Workspace-scoped file list/read/write commands
- `claude-design.md`-priority prompt compiler driven from chat
- Codex CLI check and `codex exec` runner
- One-pass automatic repair when generated workspace verification fails
- Run history persisted to `.designforge/runs.jsonl`
- Chat feedback memory persisted to `.designforge/comments.jsonl`
- Element comment anchors indexed at `.designforge/anchors.json`
- Generated workspace typecheck/build command
- Workspace Vite preview controls
- Preview status manifest at `.designforge/preview.json`, including HTTP health status
- Headless browser screenshot capture at `outputs/screenshots/latest.png`
- Headless browser console capture at `outputs/console/latest.json`
- Screenshot-driven critique prompt at `prompts/critique-latest.md`
- Critique manifest at `.designforge/critique.json`
- Automatic Codex critique pass after screenshot capture, with rollback if verification breaks
- Automatic implementation handoff notes at `outputs/handoff/README.md`
- Handoff zip export at `outputs/exports/designforge-handoff.zip`
- Recent run action to reveal exported handoff zip in Explorer
- Settings persisted in local storage
- Windows app icon resources generated under `src-tauri/icons`
- Native Tauri backend zip export, without PowerShell archive dependency
- Windows Codex sandbox fallback when `workspace-write` process launch fails

## Install

```powershell
npm install
```

Tauri desktop builds also require Rust/Cargo, WebView2, and Visual Studio Build Tools with VC++ + Windows SDK:

```powershell
cargo --version
```

If Cargo is missing, install Rust from rustup before running Tauri commands. If `cargo check` cannot find `link.exe` or `msvcrt.lib`, repair/install the Visual Studio Build Tools VC++ workload from an elevated installer.

## Verified Locally

The current Windows environment has completed:

```powershell
npm run typecheck
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri -- build
```

Verified generated outputs:

- Desktop executable: `src-tauri/target/release/designforge.exe`
- Windows installer: `src-tauri/target/release/bundle/nsis/DesignForge_0.1.0_x64-setup.exe`
- Successful end-to-end workspace run in `.designforge/runs.jsonl`
- Handoff zip: `designforge-workspace/outputs/exports/designforge-handoff.zip`

## Run

Frontend-only development:

```powershell
node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1420
```

Tauri desktop development:

```powershell
node ./node_modules/@tauri-apps/cli/tauri.js dev
```

Production frontend build:

```powershell
node ./scripts/build.mjs
```

Windows package build after Rust is installed:

```powershell
node ./node_modules/@tauri-apps/cli/tauri.js build
```

## Codex CLI

DesignForge assumes Codex CLI is already installed and logged in locally.

```powershell
codex --version
```

The app defaults to `codex` as the CLI path. Codex runs with:

```txt
codex exec -C <workspace> --sandbox workspace-write --skip-git-repo-check
```

## Workspace

On first chat, DesignForge creates or opens `designforge-workspace` unless a previous workspace is saved. The scaffold plus completed run outputs look like:

```txt
designforge-workspace/
  AGENTS.md
  CODEX_DESIGN.md
  DESIGN.md
  designforge.config.json
  package.json
  index.html
  src/
    main.tsx
    App.tsx
    generated/
      Screen.tsx
  assets/
  artifacts/
  prompts/
    critique-latest.md
    latest.md
    repair-latest.md
  outputs/
    screenshots/
    console/
    exports/
    handoff/
  logs/
  .designforge/
    artifacts.json
    anchors.json
    comments.jsonl
    critique.json
    preview.json
    runs.jsonl
    settings.json
```

Existing files are not overwritten.

## Limitations

- Monaco is not included yet; the editor is a textarea.
- Repair currently runs once per chat request.
- Screenshot-driven critique runs only when screenshot capture succeeds; otherwise the app records a no-screenshot critique manifest.
- Element-level feedback uses `@anchor-name` references from `.designforge/anchors.json`.
- Preview process, HTTP status, screenshot evidence, and console evidence are recorded.
- Handoff export is packaged directly by the Tauri backend.
- Screenshot capture requires Microsoft Edge or Chrome headless CLI.
- Console capture requires Microsoft Edge or Chrome headless CLI.
- Codex output is captured after completion, not streamed.
- File commands are workspace-scoped. Codex falls back to `danger-full-access` only when the Windows `workspace-write` sandbox fails to launch child processes.
- Frontend typecheck/build, Rust `cargo check`, Tauri release build, and NSIS packaging are verified locally.

## Next Steps

1. Add an environment health panel for Node, npm, Rust, WebView2, Codex CLI, browser capture, and workspace dependency status.
2. Add richer run diagnostics for Codex sandbox fallback, repair attempts, critique pass, screenshot capture, console capture, and export verification.
3. Add richer screenshot inspection metadata when Codex CLI exposes it directly.
4. Add richer export formats: standalone HTML first, then PDF/PPTX if needed.
5. Add settings UI for workspace path, Codex path, package manager, and browser capture options.
