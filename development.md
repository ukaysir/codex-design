# DesignForge Chat-First Architecture

`claude-design.md` is the primary product behavior reference. This file is the implementation log for translating that behavior into a Codex + React/Tailwind + Tauri app.

The app must not expose or quote the source prompt. It should translate the behavior into product structure: understand intent, inspect context, run an AI preflight when design context is missing, create or refine a design system, generate one clear artifact by default, support targeted edits, and provide optional verification and handoff evidence.

## Core Product Decision

DesignForge should not be a multi-page tool where the user manually visits Workspace, Prompt Studio, Files, Preview, Settings, and Logs.

The primary UI is **Chat**.

The default chat path is light and design-focused:

1. Create or open a project directory under the internal workspace root.
2. Inspect existing files, assets, styles, generated artifact, and anchors.
3. Inspect `DESIGN.md` health.
4. Write `.designforge/context.json`.
5. Run a Codex preflight prompt that reads the request, `DESIGN.md`, local context, existing artifact, assets, and recent feedback.
6. Write `.designforge/clarification.json` with AI-generated interpretation, confidence, known context, missing context, and tailored questions.
7. If the preflight says questions are needed, show those questions and wait for the user's answer.
8. Seed or repair `DESIGN.md` only when it is missing, placeholder, thin, or structurally incomplete.
9. Write `.designforge/brief.json`.
10. Compile a structured prompt with clarification evidence, the design brief, context manifest, design system, generation mode, selected element context, and recent feedback.
11. Save the prompt to `prompts/latest.md`.
12. Run Codex CLI in the workspace.
13. Generate or update `src/generated/Screen.tsx`.
14. Refresh workspace files and generated artifact metadata.
15. Index `data-comment-anchor` values into `.designforge/anchors.json`.
16. Store the chat request as feedback in `.designforge/comments.jsonl`, including `@anchor` references when present.
17. Append tool/status work activity to `.designforge/activity.jsonl`.
18. Append a run record to `.designforge/runs.jsonl`.

Guided mode is the default conversation path. DesignForge does not use hardcoded questions. It runs an AI preflight after reading local context, then asks the questions produced by that preflight. If context is still missing after the user's answer, the agent records practical assumptions in `DESIGN.md` and proceeds.

Verification, repair, preview, screenshot capture, console capture, critique, quality audit, handoff, and export are manual workbench actions. They are not part of every default generation because small design iterations should not pay the full evidence cost.

## Why This Matches `claude-design.md`

The reference prompt is not mainly about UI chrome. It is about disciplined design production:

- expert designer posture
- context and resource exploration
- design-system-first output
- artifact-first output
- design-system grounding
- minimal targeted edits
- bold frontend aesthetic direction when no brand exists
- verification and preview when needed
- comments and anchors for feedback
- export and handoff paths

DesignForge implements those ideas as app structure, not as visible navigation.

## Claude Design Alignment Audit

`claude-design.md` was reviewed as a behavior reference. Its structure maps to these DesignForge decisions:

- DC files become a React/Tailwind `src/generated/Screen.tsx` artifact because this app previews Vite workspaces.
- `<mentioned-element>` becomes a preview selection bridge that posts selected `data-comment-anchor`, screen label, tag, text, and DOM path back to the host.
- `data-comment-anchor` and `data-screen-label` remain mandatory continuity primitives.
- "Small targeted change" becomes an anchored request mode that edits the selected semantic region and preserves unrelated layout, spacing, typography, colors, copy, and anchors.
- "Create/update design system first" becomes persistent `DESIGN.md`; the prompt treats it as the continuing source of truth.
- "Ask questions when needed" becomes guided mode: read files and context first, run AI preflight, ask tailored questions, then produce an artifact and record remaining assumptions or unresolved questions in the brief and `DESIGN.md`.
- "Explore alternatives" becomes variation mode: produce three comparable directions in one artifact with stable variation anchors.
- "Quality review" becomes a manual quality-audit pass with a score, findings, changes, and risks.
- The latest quality pass adds a 10-lens design review loop derived from `claude-design.md`: request fit, source truth, system first, content economy, visual distinctiveness, composition and scale, interaction realism, editability and anchors, asset integrity, and verification/handoff.

## Current App Shape

The app now has:

- One chat input
- Project side panel with create/switch actions
- Generation mode controls
- Component-level edit panel
- Pipeline status
- DesignForge workbench preview surface
- Artifact list
- Verification evidence
- Brief/context/system-health evidence
- Clarification/preflight evidence
- Quality audit evidence
- Run history and export actions
- Separate conversation and work-log tabs
- System log
- Preview click-selection bridge for anchored generated regions
- Hidden workspace, prompt, Codex, verification, critique, and export machinery

The old feature navigation is intentionally removed. Workspace, Prompt Studio, Files, Preview, Settings, and Logs are internal modules, not top-level user destinations.

## Workspace Structure

```txt
designforge-workspace/
  <project-name>-<timestamp>/
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
      project.json
      artifacts.json
      anchors.json
      activity.jsonl
      clarification.json
      brief.json
      chat.jsonl
      comments.jsonl
      context.json
      critique.json
      preview.json
      quality-audit.json
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
- instruction to read `AGENTS.md`, `CODEX_DESIGN.md`, and `DESIGN.md`
- instruction to read `.designforge/clarification.json`, `.designforge/brief.json`, and `.designforge/context.json` when present
- instruction not to block on questions
- instruction to record assumptions and unresolved questions in `DESIGN.md`
- exact artifact path
- generation mode: guided or variations
- request classification: targeted component edit, system revision, or fresh design
- continuing design-system rule: preserve `DESIGN.md` and current artifact unless the request explicitly asks for a new direction
- selected-anchor rule: requests containing `@anchor` or `<mentioned-element>` edit that semantic region first
- small-edit discipline
- anti-slop rules
- 10-lens design review rules translated from `claude-design.md`
- accessibility and semantic HTML requirements
- summary requirement

## `DESIGN.md` Behavior

On each chat:

- If `DESIGN.md` is missing, placeholder, or thin, seed it from the user's request.
- If `DESIGN.md` has useful structure but misses important sections, append a concise quality scaffold.
- If `DESIGN.md` is already substantial, preserve it.
- Codex may update `DESIGN.md` before editing the generated artifact.

The design-system health gate should reward evidence of purpose, audience, visual direction, tokens, layout, components, interaction states, accessibility, responsive behavior, assets, quality bar, 10 quality lenses, editability/anchor policy, and revision notes.

The 10 quality lenses are:

1. Request fit
2. Source truth
3. System first
4. Content economy
5. Visual distinctiveness
6. Composition and scale
7. Interaction realism
8. Editability and anchors
9. Asset integrity
10. Verification and handoff

## Design Brief And Context

`.designforge/clarification.json` is written before the design brief. It is the record of the AI preflight pass:

- interpreted product/surface/audience/goal
- known context from files and prior feedback
- missing context that materially changes the design system
- tailored questions with the reason each answer matters
- confidence and skip/ask decision
- design-system focus areas to lock after the user's answer

`.designforge/context.json` records the local evidence available to the next Codex run:

- asset files
- style/config files
- source files
- generated artifact existence
- anchor count
- notes about available or missing evidence

`.designforge/brief.json` turns the user's request into a design task:

- request type
- audience and purpose assumptions
- generation mode
- design-system health
- clarification path and unresolved question evidence
- local context summary
- quality bar
- unresolved questions to carry forward without blocking

These manifests are part of the functional pipeline, not decorative documentation.

## Quality Audit

The quality audit is manual and user-triggered. It writes `prompts/quality-latest.md` and `.designforge/quality-audit.json`, then runs Codex against the generated workspace.

The audit must inspect:

- `CODEX_DESIGN.md`
- `AGENTS.md`
- `DESIGN.md`
- `.designforge/brief.json`
- `.designforge/clarification.json`
- `.designforge/context.json`
- generated artifact
- styles/config
- optional screenshot and console evidence

It scores the work from 0 to 100 across the 10 quality lenses plus hierarchy, typography, color discipline, accessibility, and implementation fidelity. If the score is below the quality bar or defects are clear, it makes focused improvements. If the design is already strong, it writes a no-change verdict.

## Backend Commands

Current commands cover the chat-first loop and manual evidence loop:

- `create_workspace`
- `open_workspace`
- `create_project`
- `list_projects`
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
- keep chat in `.designforge/chat.jsonl` and tool/status work activity in `.designforge/activity.jsonl`
- append chat feedback records to `.designforge/comments.jsonl`
- index generated comment anchors to `.designforge/anchors.json`
- verify generated workspace with TypeScript and Vite build on request
- start/stop workspace preview server on request
- verify preview HTTP health and write `.designforge/preview.json`
- capture screenshots on request
- capture browser console evidence on request
- export handoff zip with native Rust zip packaging
- create handoff bundle
- start Codex with `danger-full-access` on Windows and force PowerShell 7 through `windows.shell_path` when available, while keeping `workspace-write` as the default on other platforms
- create new project directories instead of clearing existing project history when the user starts a new design
- pass Codex only a short file-read instruction while storing the full prompt in `.designforge/codex-prompts/latest.md` to avoid Windows command-line length failures
- skip heavy workspace directories such as `.git`, `node_modules`, `target`, `dist`, and nested DesignForge project directories during file indexing
- run long Codex, verification, screenshot, console, and export work through blocking worker tasks instead of holding the Tauri command thread

Do not add a generic shell runner.

## Frontend Modules

Visible:

- Chat
- Generation mode selector
- Preview surface
- Pipeline status
- Artifacts
- Design brief/context/system health
- Clarification evidence
- Verification evidence
- Quality evidence
- Run history
- System log
- Export action

Internal:

- workspace manager
- project manager
- prompt compiler
- design-system health gate
- AI preflight clarification writer
- design brief writer
- context manifest writer
- Codex runner
- verification runner
- one-pass repair runner
- artifact indexer
- preview selection bridge
- selected component edit compiler
- feedback memory writer
- anchor indexer
- preview runner
- preview manifest writer
- screenshot capture
- console capture
- critique prompt runner
- quality audit prompt runner
- handoff writer
- handoff exporter

## Implementation Phases

### Phase 1 - Chat-First Foundation

Status: implemented.

- Remove top-level navigation.
- Add single chat workspace.
- Auto-open/create workspace.
- Auto-inspect local context.
- Auto-run Codex preflight for tailored questions.
- Auto-write `.designforge/clarification.json`.
- Auto-seed or repair thin `DESIGN.md`.
- Auto-write `.designforge/context.json`.
- Auto-write `.designforge/brief.json`.
- Auto-save `prompts/latest.md`.
- Auto-run Codex.
- Auto-index `data-comment-anchor` values for element-level feedback.
- Auto-store chat feedback for the next prompt.
- Show pipeline and logs.

### Phase 2 - Run History

Status: implemented.

- Write each chat run to `.designforge/runs.jsonl`.
- Include request, prompt path, artifact path, clarification path, brief path, context path, status, timestamps, stdout/stderr summary.
- Show the latest few runs in the side panel.

### Phase 3 - Preview And Verification Loop

Status: implemented as manual actions.

- Verify the generated workspace with TypeScript and Vite build on request.
- Run one Codex repair pass after a failed verification on request.
- Start workspace Vite server on request.
- Show generated screen preview.
- Write preview process and HTTP status to `.designforge/preview.json`.
- Capture preview screenshot to `outputs/screenshots/latest.png` on request.
- Capture browser console evidence to `outputs/console/latest.json` on request.
- Prepare and run `prompts/critique-latest.md` with `.designforge/critique.json` on request.
- Re-verify and roll back critique edits if verification breaks.

### Phase 4 - Performance Audit

Status: implemented for current bottlenecks.

- Remove unused TypeScript surface area found during audit work.
- Keep frontend logs bounded and truncate very large command output before rendering.
- Avoid file-list state updates when the indexed workspace entries are unchanged.
- Remove intermediate file refreshes where a final refresh already happens.
- Skip common heavy generated directories during backend file indexing.
- Move long-running backend commands to `tauri::async_runtime::spawn_blocking`.
- Record future upgrade triggers with `ponytail:` comments only where the tradeoff is intentional.

### Phase 5 - Feedback Loop

Status: implemented for anchored component feedback.

- Add user notes attached to artifact path.
- Store `@anchor-name` references when chat feedback targets an element.
- Write `.designforge/anchors.json` from generated `data-comment-anchor` attributes.
- Add simple comment records in `.designforge/comments.jsonl`.
- Preserve and generate `data-screen-label` and `data-comment-anchor` in prompt instructions.
- Compile feedback into the next Codex run.
- Inject a preview selection bridge into the workspace `src/App.tsx` wrapper.
- Let users click anchored regions in the live preview while selection mode is active.
- Show anchor-list fallback selection when preview click selection is unavailable.
- Compile selected component edits as targeted requests with `<mentioned-element>` context.

### Phase 6 - Quality System

Status: implemented.

- Add generation modes: guided and variations.
- Add AI preflight clarification manifest.
- Add `DESIGN.md` health inspection.
- Add design brief manifest.
- Add context manifest.
- Add manual quality audit prompt.
- Add quality audit manifest.
- Add quality evidence to the UI and handoff.

### Phase 7 - Export And Handoff

Status: implemented as a manual action.

- Export selected files as zip.
- Reveal exported zip from the recent run list.
- Export screenshot, console, critique, clarification, brief, context, and quality audit files when present.
- Generate handoff README with request, artifact, design-system evidence, verification, preview, screenshot, console, critique, quality audit, assets, and files.
- Later add standalone HTML, PDF, and PPTX support.

### Phase 8 - Project Isolation

Status: implemented.

- Replace the destructive new-design reset UI with `새 프로젝트 만들기`.
- Create new projects under the internal `designforge-workspace` root.
- Add a folder-button side panel that lists prior projects and switches by opening that directory.
- Keep each project's chat, activity log, run history, design system, generated artifact, prompts, preview evidence, and exports under that project directory.
- Split work activity from conversation messages so chat and task records do not mix.
- Preserve legacy root workspaces as selectable projects while skipping nested project folders during file indexing.

### Phase 9 - Claude Design Quality Lenses

Status: implemented.

- Re-read `claude-design.md` by workflow, output discipline, questions, anchors, content, frontend design, interaction/prototype, design-system creation, verification/handoff, and source/copyright lenses.
- Encode the resulting 10 quality lenses in prompt compilation, preflight questions, `DESIGN.md` seed generation, design-system health inspection, starter workspace instructions, and manual quality audit.
- Require broad design changes to record concrete decisions in `DESIGN.md` before coding.

### Phase 10 - Agentic Chat And Persistent Codex Sessions

Status: implemented.

- Keep a persistent backend `codex app-server` process instead of spawning and killing one process per chat request.
- Initialize app-server once per process and reuse the JSON-RPC connection for later turns.
- Track workspace-scoped Codex thread ids in the Tauri app-server manager.
- Reuse the live thread for the same project when possible, resume the stored thread when opening an existing project, and create a fresh thread only after reset or failed resume.
- Add app-server status, stop, and project-session reset commands.
- Surface connection, thread, event, model, and effort state in the Codex wrapper panel.
- Store agentic chat cards with optional phase/status/thread/artifact metadata in `.designforge/chat.jsonl`.
- Show request context, design-system preparation, prompt compilation, Codex execution, artifact indexing, and next actions as compact chat timeline cards.
- Preserve raw tool/status activity in `.designforge/activity.jsonl` so the chat stays conversational while still retaining evidence.

## Verification Snapshot

Use this set before release builds:

```powershell
node ./node_modules/typescript/bin/tsc --noEmit
node ./scripts/build.mjs
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
node ./node_modules/@tauri-apps/cli/tauri.js build
```

Expected release outputs:

- `src-tauri/target/release/designforge.exe`
- `src-tauri/target/release/bundle/nsis/DesignForge_0.1.0_x64-setup.exe`

## Next Plan

1. Environment health panel
   - Show Node/npm, Rust/Cargo, Visual Studio Build Tools, WebView2, browser capture, and Codex CLI availability.
   - Detect stale PATH/session issues and suggest exact recovery commands.
   - Show workspace dependency status before a chat run starts.

2. Direct edit splicing
   - For simple text-only or color-only component edits, patch the source region directly before invoking Codex.
   - Preserve the Codex targeted-edit path for structural changes, copy rewrites, and ambiguous requests.
   - Add a manifest entry showing whether an edit was direct-spliced or Codex-assisted.

3. Run diagnostics and failure UX
   - Surface Codex sandbox fallback in the run record and UI.
   - Distinguish dependency install failure, Codex CLI failure, verification failure, preview failure, screenshot failure, console failure, critique rollback, quality audit failure, and export failure.
   - Add a retry action for failed stages where the previous artifacts are still valid.

4. Export expansion
   - Add standalone HTML export from the generated workspace.
   - Keep PDF/PPTX as later formats after standalone HTML is reliable.
   - Include a machine-readable export manifest beside the zip.

5. Settings surface
   - Add UI controls for workspace path, Codex path, package manager, and browser path.
   - Persist these settings in local storage and mirror workspace-scoped settings where appropriate.

## Non-Goals

- Do not clone Claude Design's private runtime.
- Do not expose `claude-design.md` verbatim.
- Do not force the user through static design-system configuration fields before generation; use AI preflight questions only when context requires them.
- Do not keep the old multi-page navigation.
- Do not add Monaco until textarea/file editing is actually needed again.
- Do not build export formats before preview works.
