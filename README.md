# DesignForge

DesignForge is a local Windows desktop workbench for a Codex-powered UI design workflow. The app is chat-first: the user enters a design request, DesignForge runs an AI preflight pass over the request and workspace context, asks tailored design-system questions when needed, writes a design brief, updates the persistent design system, compiles a structured Codex prompt, runs Codex, refreshes the generated artifact, and indexes comment anchors.

Heavy evidence stages are intentionally user-triggered. Verification, repair, preview, screenshot capture, console capture, critique, quality audit, handoff, and export run from explicit workbench actions so small design iterations stay fast.

## Current MVP

- Tauri v2 app shell with React, TypeScript, Vite, and Tailwind CSS
- Chat-first DesignForge workbench with request intake, preview surface, pipeline evidence, artifacts, run history, quality evidence, and export actions
- Workspace create/open flow
- Starter workspace file generation
- Workspace-scoped file list/read/write commands
- `claude-design.md`-informed prompt compiler without exposing that source prompt to generated workspaces
- Persistent `DESIGN.md` design-system behavior with health inspection and repair scaffolding
- AI preflight clarification manifest at `.designforge/clarification.json`
- Design brief manifest at `.designforge/brief.json`
- Context manifest at `.designforge/context.json`
- Generation modes: guided clarification and three-variation exploration
- Component-level edit flow through preview click selection or anchor-list selection with `@anchor` and `<mentioned-element>` context
- Codex CLI check and `codex exec` runner
- Codex prompt handoff through `.designforge/codex-prompts/latest.md` to avoid Windows command-line length failures
- Manual generated workspace verification
- Manual one-pass repair for failed verification
- Manual Vite preview controls
- Manual screenshot and console capture
- Manual screenshot/console-driven critique with rollback when verification breaks
- Manual quality audit prompt and manifest at `prompts/quality-latest.md` and `.designforge/quality-audit.json`
- Manual implementation handoff notes at `outputs/handoff/README.md`
- Manual handoff zip export at `outputs/exports/designforge-handoff.zip`
- Run history persisted to `.designforge/runs.jsonl`
- Chat feedback memory persisted to `.designforge/comments.jsonl`
- Element comment anchors indexed at `.designforge/anchors.json`
- Recent run action to reveal exported handoff zip in Explorer
- Settings persisted in local storage
- Native Tauri backend zip export, without PowerShell archive dependency
- Windows Codex sandbox fallback when `workspace-write` process launch fails
- Performance pass: heavy workspace folders are skipped, long backend jobs run off the Tauri command thread, unchanged file lists avoid rerenders, intermediate refreshes are reduced, and large logs are capped/truncated

## Install

```powershell
npm install
```

Tauri desktop builds also require Rust/Cargo, WebView2, and Visual Studio Build Tools with VC++ + Windows SDK:

```powershell
cargo --version
```

If Cargo is missing, install Rust from rustup before running Tauri commands. If `cargo check` cannot find `link.exe` or `msvcrt.lib`, repair or install the Visual Studio Build Tools VC++ workload from an elevated installer.

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

On Windows, DesignForge starts Codex with `--sandbox danger-full-access` because the Codex `workspace-write` sandbox can fail to launch PowerShell child processes with `CreateProcessAsUserW failed: 5`. It also forces Codex's Windows shell path to PowerShell 7 (`pwsh.exe`) when available, preferring `DESIGNFORGE_PWSH_PATH`, `Downloads\PowerShell-7.6.2-win-x64\pwsh.exe`, `Program Files\PowerShell\7\pwsh.exe`, and then PATH. On other platforms, it keeps `workspace-write` as the default and still falls back to `danger-full-access` if that sandbox fails.

Long prompts are not passed directly as command-line arguments. DesignForge writes the full prompt to `.designforge/codex-prompts/latest.md` and sends Codex a short instruction to read that file, avoiding Windows `os error 206`.

The `새 디자인 시작` control resets the current workspace design state: chat, run history, DesignForge manifests, `DESIGN.md`, `src/generated/Screen.tsx`, and shared generated styles return to the starter state before the next run.

## Workspace

On first chat, DesignForge creates or opens `designforge-workspace` unless a previous workspace is saved. Existing files are not overwritten. The scaffold plus generated run outputs look like:

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
    clarification-latest.md
    latest.md
    repair-latest.md
    critique-latest.md
    quality-latest.md
  outputs/
    screenshots/
    console/
    exports/
    handoff/
  logs/
  .designforge/
    artifacts.json
    anchors.json
    clarification.json
    brief.json
    comments.jsonl
    context.json
    critique.json
    preview.json
    quality-audit.json
    runs.jsonl
    settings.json
```

## Default Chat Run

The default chat path is intentionally narrow:

1. Open or create the workspace.
2. Inspect workspace context.
3. Inspect `DESIGN.md` health without locking a generic system too early.
4. Write `.designforge/context.json`.
5. Run Codex preflight from `prompts/clarification-latest.md`.
6. Write `.designforge/clarification.json` with request interpretation, known context, missing context, and tailored questions.
7. If questions are needed, wait for the user's answer.
8. Write `.designforge/brief.json`.
9. Compile `prompts/latest.md`.
10. Run Codex generation.
11. Refresh files and generated artifacts.
12. Index `data-comment-anchor` values.
13. Append a run record.

The app does not automatically verify, preview, capture, critique, quality-audit, handoff, or export after every chat request.

## Manual Actions

- `검증 실행`: run the same backend TypeScript/Vite workspace verification used before preview. On Windows, the backend searches common `node.exe` locations instead of relying only on the app process PATH.
- `수리`: run one repair prompt from the latest failed verification.
- `미리보기`: start the workspace Vite preview and write `.designforge/preview.json`.
- `캡처`: capture browser console and screenshot evidence.
- `크리틱`: run screenshot/console-driven critique and roll back if verification breaks.
- `품질 검사`: run a quality audit grounded in `DESIGN.md`, clarification evidence, the design brief, context manifest, artifact, styles, and optional screenshot evidence.
- `핸드오프 생성`: write `outputs/handoff/README.md` and package `outputs/exports/designforge-handoff.zip`.

## Verified Locally

The intended local verification set is:

```powershell
node ./node_modules/typescript/bin/tsc --noEmit
node ./scripts/build.mjs
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
node ./node_modules/@tauri-apps/cli/tauri.js build
```

Verified generated outputs:

- Desktop executable: `src-tauri/target/release/designforge.exe`
- Windows installer: `src-tauri/target/release/bundle/nsis/DesignForge_0.1.0_x64-setup.exe`
- Optional handoff zip: `designforge-workspace/outputs/exports/designforge-handoff.zip`

## Limitations

- Monaco is not included yet; the editor is a textarea.
- Verification and repair are manual actions after generation.
- Screenshot-driven critique runs only when screenshot evidence exists; otherwise the app records missing evidence.
- Quality audit can run without screenshot evidence, but visual findings are stronger when preview capture exists.
- Element-level feedback uses `@anchor-name` references from `.designforge/anchors.json`.
- Preview click editing depends on generated elements carrying `data-comment-anchor`; unanchored elements can still be edited through chat but are not directly selectable.
- Screenshot capture requires Microsoft Edge or Chrome headless CLI.
- Console capture requires Microsoft Edge or Chrome headless CLI.
- Codex output is captured after completion, not streamed.
- File commands are workspace-scoped.

## Next Steps

1. Add an environment health panel for Node, npm, Rust, WebView2, Codex CLI, browser capture, and workspace dependency status.
2. Add direct source splicing for simple text/color edits before invoking Codex.
3. Add per-stage diagnostics for Codex sandbox fallback, repair attempts, critique, quality audit, capture, and export.
4. Add richer export formats: standalone HTML first, then PDF/PPTX if needed.
5. Add settings UI for workspace path, Codex path, package manager, and browser capture options.
