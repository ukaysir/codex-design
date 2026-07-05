# DesignForge Quality Implementation Goal

## Objective

DesignForge exists to produce better design, not merely to generate React files. The implementation should translate `claude-design.md` into product behavior that improves visual direction, design-system grounding, iteration quality, verification, and handoff precision while keeping expensive work user-requested.

## Status

Completed and verified on 2026-07-05 13:23 +09:00.

- Documentation drift repaired in `README.md`, `development.md`, and default workspace instructions.
- Design brief, context manifest, design-system health gate, generation modes, manual quality audit, and handoff quality evidence are implemented.
- Release build produced `src-tauri/target/release/designforge.exe`.
- NSIS installer produced `src-tauri/target/release/bundle/nsis/DesignForge_0.1.0_x64-setup.exe`.

## Principles

- Design quality comes before feature count.
- Keep the default generation loop lightweight: request, brief, design-system grounding, Codex generation, anchors, run record.
- Keep verification, preview, screenshot capture, critique, quality audit, and export explicitly user-triggered.
- Preserve targeted-edit discipline: small requests should not cause broad redesigns.
- Store durable evidence in workspace files so later turns improve from prior context.
- Keep documentation aligned with actual app behavior.

## Ordered Implementation Plan

### 1. Documentation Drift Repair

Status: completed.

Update README/development references that still describe automatic verification, preview, screenshot, critique, handoff, or export as default behavior. The app should be documented as request-driven for heavy stages.

Completion evidence:
- README says default generation is lightweight.
- README lists heavy stages as manual actions.
- development.md describes the current quality-first staged architecture.

### 2. Design Brief Layer

Status: completed.

Before compiling the Codex prompt, write `.designforge/brief.json` with request classification, generation mode, assumptions, likely audience, design quality bar, questions to consider, and references to context/design-system health.

Completion evidence:
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

## Non-Goals

- Do not re-enable heavy verification/preview/critique/export automatically in the default generation path.
- Do not clone Claude Design's private runtime.
- Do not expose `claude-design.md` verbatim in generated user-facing files.
- Do not add a database or plugin system for this pass.
