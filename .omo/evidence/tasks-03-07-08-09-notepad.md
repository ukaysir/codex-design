ULTRAWORK TASKS 3/7/8/9 NOTEPAD

Tier: LIGHT. Scope is one existing React file/workflow surface, no new module, backend, security, schema, or external integration.

Skills used:
- programming: TypeScript/TSX edit rules.
- frontend: existing React workbench UI/layout rules; DESIGN.md read and followed.
- ulw-loop: evidence-bound execution and artifact checks.

Scenarios:
- task-03-design-only-pipeline: `rg ... src/App.tsx src/lib` plus node block check against `runDesignRequest`; binary observable is node exit 0 and no forbidden strings in the function block.
- task-07-3pane-ui: `npm run build` via npm with Git Bash script shell; binary observable is exit 0 and Vite built output in evidence.
- task-08-selection-composer: `rg` confirms preview selection/composer state and `selection-ready preview` UI near composer.
- task-09-manual-tools: `rg` confirms runtime controls are explicit; broad `await verifyWorkspace` match is documented as the manual verify button handler.

Self-review:
- `runDesignRequest` no longer calls preview, verify, capture, critique, quality, repair, export, typecheck, or tsc paths; it stops after Codex/static metadata refresh and run history.
- Preview selection bridge is prepared by manual preview startup, not default generation or generic manual action setup.
- Critique and quality consume existing manual capture artifacts only; missing screenshot stops with a user instruction to run preview/capture manually.
- Desktop workbench is a three-column grid at `lg`; mobile stacks command/workbench and keeps inspector hidden unless toggled.
- `src/App.tsx` is an inherited oversized central file; user explicitly requested scoped App.tsx edits because the app is mid-rewrite, so no structural split was attempted.

Review-work skill note: multi_agent_v1 reviewer tools are not available in this session, so the 5-agent review gate is inconclusive/not run. Local self-review plus requested evidence commands passed.
