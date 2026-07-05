# DesignForge Quality Implementation Goal

## Objective

DesignForge exists to produce better design, not merely to generate React files. The implementation should translate `claude-design.md` into product behavior that improves visual direction, design-system grounding, iteration quality, verification, and handoff precision while keeping expensive work user-requested.

## Status

Completed and verified on 2026-07-05 13:23 +09:00.

- Documentation drift repaired in `README.md`, `development.md`, and default workspace instructions.
- AI preflight clarification, design brief, context manifest, design-system health gate, generation modes, manual quality audit, and handoff quality evidence are implemented.
- Release build produced `src-tauri/target/release/designforge.exe`.
- NSIS installer produced `src-tauri/target/release/bundle/nsis/DesignForge_0.1.0_x64-setup.exe`.

Correction pass completed on 2026-07-05 14:30 +09:00.

- Replaced hardcoded clarification questions with a Codex preflight pass that reads request, `DESIGN.md`, context manifest, existing artifact, assets, and prior feedback.
- Added `.designforge/clarification.json` and `prompts/clarification-latest.md` as durable evidence before `brief.json`.
- Propagated clarification evidence into the design brief, generation prompt, run records, handoff README, and export bundle.
- Fixed Windows verification command reliability by resolving `node.exe` from common install locations instead of relying only on the GUI process PATH.
- Fixed Windows Codex `os error 206` long-command failures by writing full prompts to `.designforge/codex-prompts/latest.md` and passing a short file-read instruction to `codex exec`.
- Fixed Windows Codex `workspace-write` sandbox process-launch failures (`CreateProcessAsUserW failed: 5`) by starting Codex runs with `danger-full-access` on Windows.
- Forced Windows Codex runs to prefer PowerShell 7 (`pwsh.exe`) through `windows.shell_path` and PATH prepending, avoiding Windows PowerShell 5.1 command-launch failures.
- Superseded the earlier `새 디자인 시작` reset behavior in the later project-isolation pass; new design work now creates or switches project directories instead of clearing prior state.
- Preserved the original request after preflight failure so a follow-up like "진행해" continues from the original long request instead of replacing it.
- Re-verified workspace TypeScript/Vite commands, TypeScript, frontend build, Rust check, Clippy, Knip, and Tauri release packaging.
- Latest release build after the `os error 206` fix completed on 2026-07-05 14:40 +09:00.

Project isolation and design-quality pass completed on 2026-07-05.

- Replaced the destructive `새 디자인 시작` reset UI with `새 프로젝트 만들기`.
- New projects are created as directories under the internal `designforge-workspace` root.
- Added a folder-button project side panel for opening previous project directories and continuing their `DESIGN.md`, generated screen, chat context, and run history.
- Split conversation chat into `.designforge/chat.jsonl` and tool/status work activity into `.designforge/activity.jsonl`.
- Added project metadata, project listing, and nested-project indexing guards in the Tauri backend.
- Re-read `claude-design.md` through 10 quality lenses and encoded those lenses in prompt compilation, preflight questions, `DESIGN.md` seed generation, health scoring, starter workspace instructions, and quality audit prompts.
- Added `diff.md` as the durable comparison and upgrade report.

## Principles

- Design quality comes before feature count.
- Keep the default generation loop evidence-driven: request, AI preflight clarification, brief, design-system grounding, Codex generation, anchors, run record.
- Keep verification, preview, screenshot capture, critique, quality audit, and export explicitly user-triggered.
- Preserve targeted-edit discipline: small requests should not cause broad redesigns.
- Store durable evidence in workspace files so later turns improve from prior context.
- Keep documentation aligned with actual app behavior.
- Never clear prior projects to start a new design; create or switch project directories instead.
- Treat natural-language design requests as input to a repeatable design-quality decision loop, not just code generation.

## Ordered Implementation Plan

### 1. Documentation Drift Repair

Status: completed.

Update README/development references that still describe automatic verification, preview, screenshot, critique, handoff, or export as default behavior. The app should be documented as request-driven for heavy stages.

Completion evidence:
- README says default generation is lightweight.
- README lists heavy stages as manual actions.
- development.md describes the current quality-first staged architecture.

### 2. AI Clarification And Design Brief Layer

Status: completed.

Before compiling the Codex prompt, run AI preflight and write `.designforge/clarification.json`, then write `.designforge/brief.json` with request classification, generation mode, assumptions, likely audience, design quality bar, questions to consider, and references to context/design-system health.

Completion evidence:
- `.designforge/clarification.json` is created from Codex preflight before questions.
- Questions come from the AI preflight manifest, not hardcoded UI lists.
- `.designforge/brief.json` is created during each design run.
- `prompts/latest.md` includes the design brief.
- The UI exposes generation mode: guided or variations.

### 3. Context Manifest

Status: completed.

Write `.designforge/context.json` before generation. It should summarize available assets, style files, generated artifact state, anchor count, and relevant workspace files without reading heavy directories.

Completion evidence:
- `.designforge/context.json` is created during each design run.
- Prompt includes context summary.
- Handoff/export includes context manifest.

### 4. Design-System Health Gate

Status: completed.

Replace length-only `DESIGN.md` seeding with section-level inspection. Score purpose, tone, differentiation, visual foundations, component inventory, content rules, implementation rules, and revision rules. Upgrade thin systems without overwriting strong existing systems.

Completion evidence:
- `.designforge/brief.json` records the design-system score and missing sections.
- Thin `DESIGN.md` gets a stronger scaffold.
- Existing substantial systems are preserved.

### 5. Manual Quality Audit Loop

Status: completed.

Add an explicit `품질 검사` action that prepares `prompts/quality-latest.md`, writes `.designforge/quality-audit.json`, optionally uses screenshot/console evidence, asks Codex to improve only clear quality failures, verifies after the audit, and rolls back if verification breaks.

Completion evidence:
- UI has a quality audit action.
- Quality audit writes prompt/manifest files.
- Failed audit edits roll back.
- Successful audit refreshes anchors and records chat status.

### 6. Variation Mode

Status: completed.

Add a generation mode that asks Codex to create 3 distinct directions in one artifact when the user wants exploration. The result should preserve anchors and make the options comparable without spawning unrelated files.

Completion evidence:
- UI offers a variations mode.
- Prompt includes variation-specific instructions.
- `DESIGN.md` records selected or pending variation assumptions.

### 7. Handoff Precision Upgrade

Status: completed.

Improve handoff output to include brief, context, design-system health, quality audit status, exact design tokens, interaction notes, responsive notes, and caveats.

Completion evidence:
- `outputs/handoff/README.md` references brief/context/quality audit.
- Export bundle includes the new quality files.

## Verification Gates

Completed:

- TypeScript check: `node ./node_modules/typescript/bin/tsc --noEmit`
- Frontend build: `node ./scripts/build.mjs`
- Rust check: `cargo check --manifest-path src-tauri/Cargo.toml`
- Rust clippy: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- Tauri release build: `node ./node_modules/@tauri-apps/cli/tauri.js build`

Current pass verification:

- TypeScript check: `node ./node_modules/typescript/bin/tsc --noEmit`
- Rust check: `cargo check --manifest-path src-tauri/Cargo.toml`

## Non-Goals

- Do not re-enable heavy verification/preview/critique/export automatically in the default generation path.
- Do not clone Claude Design's private runtime.
- Do not expose `claude-design.md` verbatim in generated user-facing files.
- Do not add a database or plugin system for this pass.
