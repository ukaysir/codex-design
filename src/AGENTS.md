# FRONTEND WORKBENCH KNOWLEDGE

## OVERVIEW

`src` owns the DesignForge desktop UI: chat-first request intake, project switching, prompt assembly, Codex runtime controls, generated artifact preview, evidence panels, and manual action buttons.

## STRUCTURE

```txt
src/
|-- App.tsx                    # Main workbench state, workflows, UI panels
|-- components/ChatRow.tsx     # Conversation/activity/agent-card rendering
|-- lib/
|   |-- prompt-template.ts     # Design, clarification, repair, critique, audit prompts
|   |-- chat-messages.ts       # Chat JSONL parsing and app-server event labels
|   |-- workspace-bridge.ts    # Preview selection wrapper copied into workspaces
|   |-- image-generation.ts    # Image-task heuristics and generated image placement
|   `-- tauri.ts               # Tauri invoke wrapper
|-- styles/globals.css         # Workbench global styling
`-- types.ts                   # Shared manifest and command result types
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add or adjust a workbench stage | `App.tsx` | Update `START_STEPS`, phase state, logs, UI controls, and manifest paths together |
| Change Codex prompt behavior | `lib/prompt-template.ts` | Preserve design-quality lenses and non-exposure rule |
| Change stream/event copy | `lib/chat-messages.ts` | User-facing labels are Korean in current UI |
| Change chat card UI | `components/ChatRow.tsx` | Keep activity and conversation presentation separate |
| Change selected-element editing | `App.tsx`, `lib/workspace-bridge.ts` | Anchor path, selected text, and class adjustments must stay aligned |
| Add a manifest field | `types.ts`, `App.tsx`, Rust command output | Frontend and Tauri structs must match camelCase JSON |

## CONVENTIONS

- `App.tsx` stores canonical generated-workspace paths as constants near the top; reuse those constants instead of repeating string literals.
- Prompt builders must tell Codex to read `AGENTS.md`, `CODEX_DESIGN.md`, `DESIGN.md`, `.designforge/*` manifests, assets, styles, and generated artifact before edits.
- Guided generation asks tailored questions only when useful; small tweaks and anchored edits should skip generic questioning.
- Keep `DESIGN.md` as the continuing design system for generated workspaces.
- Keep manual actions explicit: verify, repair, preview, capture, critique, quality audit, handoff, export.
- Use `callTauri` for backend calls and surface errors as concise workbench logs.
- Preserve Korean UI labels unless intentionally changing product language.

## ANTI-PATTERNS

- Do not quote or expose `claude-design.md` in prompts shown to users or generated workspaces.
- Do not collapse chat history and work activity into one tab or one JSONL stream.
- Do not auto-run expensive verification/capture/audit stages as part of every default chat request.
- Do not replace targeted anchor edits with full-screen regeneration when direct source splice or scoped Codex edit is enough.
- Do not introduce generic AI-SaaS design rules into prompt templates; keep the stricter DesignForge quality lenses.

## VERIFY

```powershell
npm run typecheck
npm run build
```

If UI behavior changes, run frontend dev server and manually drive the matching panel or action:

```powershell
npm run dev
```
