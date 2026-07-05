# DesignForge Chat-First Architecture

`claude-design.md` is the primary product behavior reference. This file is only the implementation log for translating that behavior into a Codex + React/Tailwind + Tauri app.

The app must not expose or quote the source prompt. It should translate the behavior into product structure: understand intent, inspect context, create a design system, generate one clear artifact, verify, iterate, and export.

## Core Product Decision

DesignForge should not be a multi-page tool where the user manually visits Workspace, Prompt Studio, Files, Preview, Settings, and Logs.

The primary UI is **Chat**.

The user types one request. DesignForge automatically runs the internal pipeline:

1. Create or open a local workspace.
2. Seed or update `DESIGN.md` from the `claude-design.md` design-agent workflow.
3. Compile a structured prompt.
4. Save the prompt to `prompts/latest.md`.
5. Run Codex CLI in the workspace.
6. Generate or update `src/generated/Screen.tsx`.
7. Verify the generated workspace.
8. If verification fails, run one repair prompt and verify again.
9. Start preview, verify HTTP response, and write `.designforge/preview.json`.
10. Capture screenshot evidence to `outputs/screenshots/latest.png`.
11. Capture runtime console evidence to `outputs/console/latest.json`.
12. Write screenshot/console-driven critique input to `prompts/critique-latest.md` and `.designforge/critique.json`.
13. Run one Codex critique pass when screenshot evidence exists.
14. Re-verify after critique and roll back critique edits if verification breaks.
15. Refresh preview/screenshot/console evidence after an applied critique.
16. Write `outputs/handoff/README.md` with verification, preview, screenshot, console, and critique evidence.
17. Package handoff files to `outputs/exports/designforge-handoff.zip`.
18. Index `data-comment-anchor` values into `.designforge/anchors.json`.
19. Store the chat request as feedback in `.designforge/comments.jsonl`, including `@anchor` references when present.
20. Refresh artifacts and logs.

No clarifying-question flow by default. If context is missing, the agent records assumptions in `DESIGN.md` and proceeds.

## Why This Matches `claude-design.md`

The reference prompt is not mainly about UI chrome. It is about disciplined design production:

- expert designer posture
- context and resource exploration
- design-system-first output
- artifact-first output
- design-system grounding
- minimal targeted edits
- bold frontend aesthetic direction when no brand exists
- verification and preview
- comments/anchors for feedback
- export and handoff paths

DesignForge should implement those ideas as app structure, not as visible navigation.

## Current App Shape

The app now has:

- One chat input
- Automatic pipeline status
- DesignForge workbench preview surface
- Artifact list
- Verification evidence
- Run history and export actions
- System log
- Hidden workspace/prompt/Codex machinery

The old feature navigation is intentionally removed. Workspace, Prompt Studio, Files, Preview, Settings, and Logs become internal modules, not top-level user destinations.

## Workspace Structure

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

## Artifact Model

Start with one real artifact:

- `react-screen`
- path: `src/generated/Screen.tsx`
- id: `screen`

Future artifacts:

- `html-design`
- `design-component`
- `deck`
- `doc`
- `handoff`

Do not build a plugin system or database yet. `.designforge/artifacts.json` is enough.

## Prompt Compiler

The prompt compiler should always produce a deterministic prompt with:

- workspace role
- instruction to read `AGENTS.md` and `DESIGN.md`
- instruction not to ask questions
- instruction to record assumptions in `DESIGN.md`
- exact artifact path
- small-edit discipline
- anti-slop rules
- accessibility and semantic HTML requirements
- summary requirement

## `DESIGN.md` Behavior

On first chat:

- If `DESIGN.md` is placeholder or thin, seed it from the user's request.
- If `DESIGN.md` is already substantial, preserve it.
- Codex may update it before editing the generated artifact.

This makes the design system automatic without asking the user to fill a form.

## Backend Commands

Current commands cover the verified chat-first loop:

- `create_workspace`
- `open_workspace`
- `list_workspace_files`
- `read_file`
- `write_file`
- `check_codex`
- `run_codex`
- `verify_workspace`
- `start_preview`
- `stop_preview`
- `capture_screenshot`
- `capture_console`
- `export_handoff`
- `reveal_path`

Backend behavior implemented:

- append run records to `.designforge/runs.jsonl`
- append chat feedback records to `.designforge/comments.jsonl`
- index generated comment anchors to `.designforge/anchors.json`
- verify generated workspace with TypeScript and Vite build
- start/stop workspace preview server
- verify preview HTTP health and write `.designforge/preview.json`
- capture screenshots
- capture browser console evidence
- write and run critique prompt/manifest from screenshot and console evidence
- roll back critique edits if post-critique verification fails
- export handoff zip with native Rust zip packaging
- create handoff bundle
- fall back from Codex `workspace-write` to `danger-full-access` only when the Windows sandbox cannot launch child processes
- skip heavy workspace directories such as `.git`, `node_modules`, `target`, and `dist` during file indexing
- run long Codex, verification, screenshot, console, and export work through blocking worker tasks instead of holding the Tauri command thread

Do not add a generic shell runner.

## Frontend Modules

Visible:

- Chat
- Preview surface
- Pipeline status
- Artifacts
- Verification evidence
- Run history
- System log

Internal:

- workspace manager
- prompt compiler
- design-system seeder
- Codex runner
- verification runner
- one-pass repair runner
- artifact indexer
- handoff writer
- feedback memory writer
- anchor indexer
- preview runner later
- preview manifest writer
- screenshot capture
- console capture
- critique prompt runner
- handoff exporter
- exporter later

## Implementation Phases

### Phase 1 - Chat-First MVP

Status: implemented in the current app shell.

- Remove top-level navigation.
- Add single chat workspace.
- Auto-open/create workspace.
- Auto-seed `DESIGN.md`.
- Auto-save `prompts/latest.md`.
- Auto-run Codex.
- Auto-repair once if verification fails.
- Auto-write handoff README after successful verification.
- Auto-write preview manifest after preview start/stop/error.
- Auto-capture screenshot evidence after preview succeeds.
- Auto-capture browser console evidence after preview succeeds.
- Auto-run screenshot-driven critique after preview succeeds.
- Auto-roll back critique edits if post-critique verification fails.
- Auto-export handoff zip after successful handoff generation.
- Auto-index `data-comment-anchor` values for element-level feedback.
- Show a recent-run action to reveal the exported zip in Explorer.
- Auto-store chat feedback for the next prompt.
- Show pipeline and logs.

### Phase 2 - Run History

Status: implemented.

- Write each chat run to `.designforge/runs.jsonl`.
- Include request, prompt path, artifact path, status, timestamps, stdout/stderr summary.
- Show the latest few runs in the side panel.

### Phase 3 - Preview Loop

Status: implemented for MVP.

- Start workspace Vite server.
- Show generated screen preview.
- Write preview process and HTTP status to `.designforge/preview.json`.
- Capture preview screenshot to `outputs/screenshots/latest.png`.
- Capture browser console evidence to `outputs/console/latest.json`.
- Typecheck and build the generated workspace before preview.
- Run one Codex repair pass if typecheck/build fails.
- Write a handoff README with verification and preview status.
- Prepare and run `prompts/critique-latest.md` with `.designforge/critique.json` after screenshot capture.
- Re-verify and refresh screenshot/console evidence after applied critique.
- Capture screenshot to `outputs/screenshots/`. Basic latest screenshot capture is implemented.
- Feed console logs into critique.

### Phase 4 - Performance And Ponytail Audit

Status: implemented for current bottlenecks.

- Apply the Ponytail audit workflow from `DietrichGebert/ponytail` without adding a runtime dependency.
- Remove unused TypeScript surface area found during the audit.
- Keep frontend logs bounded and truncate very large command output before rendering.
- Avoid file-list state updates when the indexed workspace entries are unchanged.
- Remove intermediate file refreshes inside repair and critique stages where a final refresh already happens.
- Skip common heavy generated directories during backend file indexing.
- Move long-running backend commands to `tauri::async_runtime::spawn_blocking`.
- Record future upgrade triggers with `ponytail:` comments only where the tradeoff is intentional.

### Phase 5 - Feedback Loop

Status: partially implemented.

- Add user notes attached to artifact path. Chat-level feedback records are implemented.
- Store `@anchor-name` references when chat feedback targets an element.
- Write `.designforge/anchors.json` from generated `data-comment-anchor` attributes.
- Add simple comment records. `.designforge/comments.jsonl` is implemented.
- Preserve and generate `data-screen-label` and `data-comment-anchor` in prompt instructions.
- Compile feedback into the next Codex run. Recent feedback is injected into `prompts/latest.md`.

### Phase 6 - Export And Handoff

Status: implemented for MVP.

- Export selected files as zip. Native backend handoff zip export is implemented.
- Reveal exported zip from the recent run list.
- Export screenshot, console, and critique files.
- Generate handoff README with screens, layout, interactions, tokens, assets, and files. Basic README generation is implemented.
- Later add standalone HTML, PDF, and PPTX support.

## Verification Snapshot

Verified on Windows after dependency installation and Tauri resource repair:

- `npm run typecheck` passes.
- `node ./node_modules/typescript/bin/tsc --noEmit --noUnusedLocals --noUnusedParameters --pretty false` passes.
- `npm run build` passes.
- `cargo check --manifest-path src-tauri/Cargo.toml` passes.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` passes.
- `npx --yes knip --reporter compact` passes with no unused-code findings.
- `npm run tauri -- build` produces `src-tauri/target/release/designforge.exe`.
- NSIS packaging produces `src-tauri/target/release/bundle/nsis/DesignForge_0.1.0_x64-setup.exe`.
- A real chat run completed successfully with preview, screenshot, console capture, critique, handoff README, and handoff zip.
- Latest successful workspace run recorded `consoleErrorCount: 0`, `consoleWarningCount: 0`, `anchorCount: 2`, and `critiqueStatus: applied`.

## Next Plan

1. Environment health panel
   - Show Node/npm, Rust/Cargo, Visual Studio Build Tools, WebView2, browser capture, and Codex CLI availability.
   - Detect stale PATH/session issues and suggest exact recovery commands.
   - Show workspace dependency status before a chat run starts.

2. Run diagnostics and failure UX
   - Surface Codex sandbox fallback in the run record and UI.
   - Distinguish dependency install failure, Codex CLI failure, verification failure, preview failure, screenshot failure, console failure, critique rollback, and export failure.
   - Add a retry action for failed stages where the previous artifacts are still valid.

3. Performance profiling
   - Add per-stage duration markers for Codex, verification, preview startup, screenshot capture, console capture, critique, and export.
   - Persist the slowest stage in each run record so repeated lag reports have evidence.
   - Add a lightweight UI indicator when the backend is running a blocking worker task.

4. Export expansion
   - Add standalone HTML export from the generated workspace.
   - Keep PDF/PPTX as later formats after standalone HTML is reliable.
   - Include a machine-readable export manifest beside the zip.

5. Settings surface
   - Add UI controls for workspace path, Codex path, package manager, and browser path.
   - Persist these settings in local storage and mirror workspace-scoped settings where appropriate.

6. Screenshot and critique evidence
   - Add richer screenshot metadata: viewport size, browser path, capture duration, image dimensions, and file size.
   - Add console summary metadata to `.designforge/critique.json` and handoff README.

## Non-Goals

- Do not clone Claude Design's private runtime.
- Do not expose `claude-design.md` verbatim.
- Do not ask the user to configure design-system fields before generation.
- Do not keep the old multi-page navigation.
- Do not add Monaco until textarea/file editing is actually needed again.
- Do not build export formats before preview works.
