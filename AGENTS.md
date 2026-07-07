# PROJECT KNOWLEDGE BASE

**Generated:** 2026-07-07
**Commit:** not a git worktree
**Branch:** not a git worktree

## OVERVIEW

DesignForge is a Windows-first Tauri v2 desktop workbench for Codex-powered UI design. Frontend is React 19, TypeScript, Vite, Tailwind, and lucide-react; backend is Rust/Tauri commands that manage project workspaces, Codex app-server/exec runs, verification, preview, capture, critique, audit, handoff, and export.

## STRUCTURE

```txt
codex-design-main/
|-- src/                       # React workbench UI and prompt orchestration
|-- src-tauri/                 # Native Tauri shell, commands, Codex/process/file IO
|   `-- src/scaffold/          # Files copied into generated DesignForge workspaces
|-- scripts/build.mjs          # TypeScript diagnostics plus Vite production build
|-- claude-design.md           # Product behavior reference; never expose verbatim
|-- development.md             # Implementation log and design rationale
`-- README.md                  # User-facing behavior and verification notes
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Workbench UI, chat flow, panels | `src/App.tsx` | Large file; preserve state and manifest path constants |
| Chat row rendering | `src/components/ChatRow.tsx` | Agent cards and chat/status display |
| Prompt text and design rules | `src/lib/prompt-template.ts` | Do not quote `claude-design.md`; translate behavior |
| Chat/event normalization | `src/lib/chat-messages.ts` | Korean labels for app-server stream events |
| Preview click-selection bridge | `src/lib/workspace-bridge.ts` | Mirrors scaffold `App.tsx` selection bridge |
| Shared frontend types | `src/types.ts` | Manifest and command result contracts |
| Native workspace/Codex commands | `src-tauri/src/main.rs` | Tauri command surface and process logic |
| Generated workspace templates | `src-tauri/src/scaffold/` | Copied by `create_default_files`; template AGENTS applies to child workspaces |
| Template include registry | `src-tauri/src/scaffold.rs` | Keep big template text out of `main.rs` |

## CODE MAP

LSP unavailable in this environment; map from static scans.

| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `App` | React component | `src/App.tsx` | Main workbench shell and workflow owner |
| `START_STEPS` | constant | `src/App.tsx` | Pipeline phase model shown in UI |
| `buildStructuredPrompt` | function | `src/lib/prompt-template.ts` | Main Codex design prompt compiler |
| `buildDesignClarificationPrompt` | function | `src/lib/prompt-template.ts` | Preflight question manifest prompt |
| `buildRepairPrompt` | function | `src/lib/prompt-template.ts` | Failed verification repair prompt |
| `buildCritiquePrompt` | function | `src/lib/prompt-template.ts` | Screenshot/console critique prompt |
| `buildQualityAuditPrompt` | function | `src/lib/prompt-template.ts` | Manual quality audit prompt |
| `parseChatMessageRecords` | function | `src/lib/chat-messages.ts` | JSONL chat history parser |
| `WORKSPACE_SELECTION_APP_TSX` | constant | `src/lib/workspace-bridge.ts` | Generated preview-selection wrapper |
| `create_workspace` | Tauri command | `src-tauri/src/main.rs` | Creates legacy/default workspace files |
| `create_project` | Tauri command | `src-tauri/src/main.rs` | Creates project directory with scaffold |
| `list_projects` | Tauri command | `src-tauri/src/main.rs` | Finds DesignForge projects |
| `run_codex_app_server` | Tauri command | `src-tauri/src/main.rs` | Persistent JSON-RPC Codex runtime |
| `run_codex_blocking` | function | `src-tauri/src/main.rs` | `codex exec` fallback |
| `verify_workspace_blocking` | Tauri command | `src-tauri/src/main.rs` | Workspace TypeScript/Vite verification |
| `start_preview` | Tauri command | `src-tauri/src/main.rs` | Workspace preview server |
| `capture_screenshot_blocking` | Tauri command | `src-tauri/src/main.rs` | Browser screenshot capture |
| `capture_console_blocking` | Tauri command | `src-tauri/src/main.rs` | Browser console capture |
| `export_handoff_blocking` | Tauri command | `src-tauri/src/main.rs` | Handoff package zip |
| `create_default_files` | function | `src-tauri/src/main.rs` | Writes scaffold into new projects |
| `AGENTS_MD` and peers | constants | `src-tauri/src/scaffold.rs` | `include_str!` bindings for scaffold files |

## CONVENTIONS

- `claude-design.md` is source behavior, not user-visible copy. Apply its design workflow through prompts, manifests, `DESIGN.md`, and generated files.
- Heavy evidence stages are manual: verification, repair, preview, screenshot, console capture, critique, quality audit, handoff, and export do not run automatically after every chat turn.
- Project state lives in generated workspaces under `.designforge/`; chat JSONL and activity JSONL are separate.
- Long Codex prompts are written to `.designforge/codex-prompts/latest.md` before handoff to avoid Windows command-line length failures.
- Windows Codex execution may use `danger-full-access` because `workspace-write` can fail to launch PowerShell child processes.
- App-server is preferred over `codex exec`; workspace-thread reuse is part of product behavior.
- Generated UI must keep `data-screen-label` and stable `data-comment-anchor` values so targeted feedback works.

## ANTI-PATTERNS

- Do not expose or quote `claude-design.md` or internal prompts in user-facing output.
- Do not erase existing project history when creating a new design; create or switch project directories instead.
- Do not mix chat records with tool/status activity records.
- Do not regenerate an entire generated screen for a targeted `@anchor` or selected-element edit.
- Do not modify generated-workspace scaffold files casually; changes affect every new project.
- Do not add shell/dependency changes to generated workspaces unless required by the design request.

## COMMANDS

```powershell
npm install
npm run dev
npm run typecheck
npm run build
npm run tauri:dev
npm run tauri:build
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

## NOTES

- This checkout is not currently inside a git worktree.
- `src/App.tsx` and `src-tauri/src/main.rs` are large central files; inspect callers and manifest constants before editing behavior.
- `src-tauri/src/scaffold/AGENTS.md` is copied into generated workspaces. Its instructions are for Codex working inside generated UI projects, not for this parent app.
- LSP was unavailable during initialization; use TypeScript/Rust compiler commands for verification.
