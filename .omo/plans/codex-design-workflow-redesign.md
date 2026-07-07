# codex-design-workflow-redesign - Work Plan

## TL;DR (For humans)

**What you'll get:** DesignForge를 빠른 "디자인 전용" 작업대로 재구성한다. 현재 이미지 생성 기능은 완전히 제거하고, OpenCode 느낌의 고밀도 3-pane UI와 고정 composer, component click-edit 흐름을 만든다.

**Why this approach:** 문제의 핵심은 기능 부족보다 기본 실행 경로가 너무 무겁고 화면 흐름이 분리된 것이다. 그래서 먼저 자동 preview/test/install/image 경로를 끊고, 디자인 산출과 수동 검증 도구를 분리한다.

**What it will NOT do:** 기본 디자인 요청에서 preview, browser capture, runtime test, npm install, `tsc --noEmit`, 이미지 생성을 자동 실행하지 않는다. ima2-gen은 이번 wave에서 외부 서비스로 붙이지 않는다.

**Effort:** Large
**Risk:** Medium - `src/App.tsx`에 UI, pipeline, manual action이 강하게 묶여 있어 분리 작업 중 회귀 위험이 있다.
**Decisions to sanity-check:** 현재 이미지 생성은 완전 삭제, JetBrains Mono 고정, 3-pane, 고정 composer, default `tsc` off, image workspace는 내장형으로 추후 구현.

Your next move: approve implementation start, or request one more review pass on this plan.

---

> TL;DR (machine): Large/Medium; remove imagegen, make default runs design-only, redesign shell as JetBrains/OpenCode 3-pane, document embedded image workspace.

## Scope
### Must have
- Current image generation removal
  - Remove `$imagegen` prompt path, image request detection, image generation button/action, generated image manifest writes, generated image prompt writes, and image placement pass from active product code.
  - Preserve ordinary image attachments as design references. Attachment support is not the feature being removed.
- Design-only default pipeline
  - A normal design request may run Codex generation and lightweight source/static metadata refresh only.
  - It must not auto-run preview server, browser capture, QA screenshots, critique, quality audit, repair, export, package install, `npm run typecheck`, or `tsc --noEmit`.
  - Product copy and prompt contract must say DesignForge stops at design unless the user explicitly triggers runtime validation.
- Dependency behavior
  - `verify_workspace` and `start_preview` must not install dependencies implicitly.
  - Missing dependency state must be surfaced as a clear result, not hidden package-manager work.
- OpenCode-style UI redesign
  - Left pane: command/chat stream and compact run history.
  - Center pane: artifact workbench, preview/selection surface, selected target context, fixed composer.
  - Right pane: design context, files/anchors, diagnostics, manual actions.
  - JetBrains Mono everywhere.
  - Dense TUI/dashboard language: hairline borders, compact spacing, rectangular controls, ASCII/CLI markers where useful.
- Component click-edit fix
  - Add a clear manual "selection-ready preview" action.
  - When a component is selected, its target context must appear adjacent to the fixed composer.
  - The next design prompt must include selected component context automatically.
- Manual-only runtime tools
  - Preview, verify, capture, critique, quality, repair, export remain available only as explicit user-triggered actions.
  - Manual critique/quality must not silently start preview/capture/verify.
- Future image generation architecture
  - Write an implementation-ready embedded Image Workspace contract inspired by ima2-gen: prompt enhancer, provider abstraction, job progress, history, asset picking, and context-aware prompt extraction.
  - No disabled "coming soon" image panel in this wave.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- No automatic `tsc --noEmit` in the DesignForge default design path.
- No automatic package install from preview, verify, or normal generation.
- No current `$imagegen` compatibility shim, hidden route, dormant button, or image dashboard placeholder.
- No external local ima2-gen server launched by DesignForge.
- No Berkeley Mono or paid/proprietary font dependency.
- No one-note purple/blue/beige theme, marketing hero, decorative gradient, orb, or nested-card dashboard.
- No broad unrelated refactor. Extraction is allowed only where it directly supports the 3-pane redesign or safe removal.

## Verification strategy
> Zero human intervention for implementation verification. User runtime testing remains outside the default DesignForge pipeline.

- Test decision: characterization-first, then tests-after/command QA.
- Important distinction:
  - Product behavior must keep `tsc --noEmit` off by default.
  - Implementation QA may run repository build/check commands to verify DesignForge itself, but must not add those commands into the generated-design workflow.
- Required evidence directory: `.omo/evidence/`
- Required evidence files:
  - `.omo/evidence/task-01-current-behavior.txt`
  - `.omo/evidence/task-02-image-removal.txt`
  - `.omo/evidence/task-03-design-only-pipeline.txt`
  - `.omo/evidence/task-04-no-auto-install.txt`
  - `.omo/evidence/task-05-prompt-contract.txt`
  - `.omo/evidence/task-06-design-system.txt`
  - `.omo/evidence/task-07-3pane-ui.txt`
  - `.omo/evidence/task-08-selection-composer.txt`
  - `.omo/evidence/task-09-manual-tools.txt`
  - `.omo/evidence/task-10-image-workspace-contract.txt`
  - `.omo/evidence/task-11-final-qa.txt`
- Command baseline:
  - `rg -n "\$imagegen|runImageGenerationRequest|buildImageGenerationPrompt|isImageGenerationRequest|IMAGE_PROMPT_PATH|generated-images" src src-tauri`
  - `rg -n "ensure_workspace_dependencies|arg\(\"install\"\)|npm|pnpm|bun|yarn|install" src-tauri/src src`
  - `npm run build` for DesignForge product verification only.
  - `cargo check --manifest-path src-tauri/Cargo.toml`
- UI QA baseline:
  - Start DesignForge app QA only: `npm run dev -- --host 127.0.0.1 --port 1420`
  - Browser QA at `http://127.0.0.1:1420`
  - Capture desktop 1440x900 and compact mobile 390x844.
  - Validate: 3 panes, fixed composer, no imagegen controls, runtime tools demoted, no clipped Korean/English text.

## Execution strategy
### Parallel execution waves
- Wave A: Characterize current behavior.
- Wave B: Backend dependency install removal in `src-tauri/src/main.rs` can run after Wave A.
- Wave C: App workflow/UI edits in `src/App.tsx` must be serialized: image removal -> design-only pipeline -> 3-pane shell -> selection composer -> manual runtime controls.
- Wave D: Prompt contract and design-system/docs work can run only when their named App dependencies are satisfied.
- Wave E: Final QA runs only after all App, backend, prompt, CSS, and docs work is complete.
- Wave E: Write embedded Image Workspace architecture contract for the later ima2-gen rebuild.
- Final Wave: Build/check/browser QA/evidence review.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | none | 2,4,6 | none |
| 2 | 1 | 3,10,11 | 4,6 |
| 3 | 2 | 5,7,9,11 | 4,6 |
| 4 | 1 | 8,9,11 | 2,6 |
| 5 | 3 | 10,11 | 6 |
| 6 | 1 | 7 | 4 |
| 7 | 3,6 | 8,9,11 | 10 |
| 8 | 4,7 | 9,11 | 10 |
| 9 | 3,4,8 | 11 | 10 |
| 10 | 2,5 | 11 | 7,8,9 |
| 11 | 2-10 | final report | none |

## Todos
> Implementation + Test = ONE todo. Never separate.

- [x] 1. Characterize current image, runtime, install, and design-run behavior
  What to do / Must NOT do: Capture current behavior before editing. Do not change product code in this task.
  Parallelization: Wave A | Blocked by: none | Blocks: 2,3,4,6
  References: `src/App.tsx`, `src/lib/image-generation.ts`, `src/lib/prompt-template.ts`, `src-tauri/src/main.rs`
  Acceptance criteria: Evidence identifies every current imagegen entry point, default generation call path, preview/verify dependency install path, and manual QA chain.
  QA scenarios:
  - happy: `rg -n "\$imagegen|runImageGenerationRequest|buildImageGenerationPrompt|isImageGenerationRequest|IMAGE_PROMPT_PATH|GENERATED_IMAGES|generated-images|ImageIcon" src src-tauri > .omo/evidence/task-01-current-behavior.txt`
  - failure: `rg -n "ensure_workspace_dependencies|start_preview|verify_workspace|runManualCapture|runManualCritique|runManualQuality|runManualRepair|tsc|install" src src-tauri >> .omo/evidence/task-01-current-behavior.txt`
  Commit: N

- [x] 2. Remove active current image generation feature
  What to do / Must NOT do: Remove `$imagegen` detection, composer image-generation button, image prompt writes, generated image manifest writes, and placement pass. Must not remove normal user image attachments.
  Parallelization: Wave A | Blocked by: 1 | Blocks: 10,11
  References: `src/App.tsx`, `src/lib/image-generation.ts`, any imports/constants found in task 1
  Acceptance criteria: Active code has no `$imagegen`, `runImageGenerationRequest`, `buildImageGenerationPrompt`, `isImageGenerationRequest`, `IMAGE_PROMPT_PATH`, or generated-images manifest path. Composer still sends text and attachments.
  QA scenarios:
  - happy: `rg -n "\$imagegen|runImageGenerationRequest|buildImageGenerationPrompt|isImageGenerationRequest|IMAGE_PROMPT_PATH|generated-images" src src-tauri > .omo/evidence/task-02-image-removal.txt || true`
  - failure: Run DesignForge product build after removal: `npm run build >> .omo/evidence/task-02-image-removal.txt`
  Commit: Y | `refactor(image): remove current generation flow`

- [x] 3. Make normal design requests stop at design/static metadata
  What to do / Must NOT do: Normal send action should create design prompt, run Codex, refresh source metadata/anchors, update run history, and stop. It must not call preview, capture, critique, quality, repair, export, dependency install, `npm run typecheck`, or `tsc --noEmit`.
  Parallelization: Wave B | Blocked by: 2 | Blocks: 5,7,9,11
  References: `src/App.tsx`
  Acceptance criteria: Default request path has no calls to `startPreviewSafely`, `verifyWorkspace`, `runManualCapture`, `runManualCritique`, `runManualQuality`, `runManualRepair`, `runManualExport`, `npm run typecheck`, or `tsc --noEmit`.
  QA scenarios:
  - happy: `rg -n "startPreviewSafely|verifyWorkspace|runManualCapture|runManualCritique|runManualQuality|runManualRepair|runManualExport|typecheck|tsc" src/App.tsx src/lib > .omo/evidence/task-03-design-only-pipeline.txt`
  - failure: `node -e "const fs=require('fs'); const s=fs.readFileSync('src/App.tsx','utf8'); const m=s.match(/async function runDesignRequest[\\s\\S]*?\\n  async function/); if(!m){throw new Error('runDesignRequest block not found')} const forbidden=['startPreviewSafely','verifyWorkspace','runManualCapture','runManualCritique','runManualQualityAudit','runManualRepair','runManualExport','typecheck','tsc --noEmit']; const found=forbidden.filter((x)=>m[0].includes(x)); if(found.length){console.error(found.join('\\n')); process.exit(1)}" >> .omo/evidence/task-03-design-only-pipeline.txt`
  Commit: Y | `fix(pipeline): stop design runs before runtime checks`

- [x] 4. Remove hidden dependency installation from preview and verify
  What to do / Must NOT do: `start_preview` and `verify_workspace` must fail fast or return a missing-dependency result. They must not run package manager install commands.
  Parallelization: Wave A | Blocked by: 1 | Blocks: 8,9,11
  References: `src-tauri/src/main.rs` functions `verify_workspace`, `verify_workspace_blocking`, `start_preview`, `ensure_workspace_dependencies`, plus frontend preview/verify result handling in `src/App.tsx`
  Acceptance criteria: No implicit `ensure_workspace_dependencies` call from preview/verify. Missing dependencies show compact actionable UI/backend result.
  QA scenarios:
  - happy: `rg -n "ensure_workspace_dependencies|arg\(\"install\"\)|npm|pnpm|bun|yarn|install" src-tauri/src src > .omo/evidence/task-04-no-auto-install.txt`
  - failure: `cargo check --manifest-path src-tauri/Cargo.toml >> .omo/evidence/task-04-no-auto-install.txt`
  - surface: `rg -n "Missing workspace dependencies|Install dependencies manually|node_modules/vite|node_modules/typescript" src-tauri/src/main.rs src/App.tsx >> .omo/evidence/task-04-no-auto-install.txt`; PASS iff missing dependency is reported without `install` execution.
  Commit: Y | `fix(runtime): stop implicit dependency install`

- [x] 5. Rewrite the DesignForge prompt contract
  What to do / Must NOT do: Update generated prompt/system copy so Codex designs and stops unless explicitly asked for runtime validation. Keep TypeScript/React syntax hygiene, anchors, and implementation notes.
  Parallelization: Wave B | Blocked by: 3 | Blocks: 11
  References: `src/lib/prompt-template.ts`, scaffold instructions, visible workflow copy
  Acceptance criteria: Prompt no longer instructs every run to preview/test/capture/verify. It explicitly forbids server start, package install, browser QA, full `tsc`, and runtime tests during normal design runs.
  QA scenarios:
  - happy: `rg -n "preview|capture|quality|critique|verify|test|tsc|install|server|runtime" src/lib src > .omo/evidence/task-05-prompt-contract.txt`
  - failure: `node -e "const fs=require('fs'); const s=fs.readFileSync('src/lib/prompt-template.ts','utf8'); const m=s.match(/export function buildStructuredPrompt[\\s\\S]*?export function buildDesignClarificationPrompt/); if(!m){throw new Error('buildStructuredPrompt block not found')} const required=['stop at design','Do not start servers','Do not install packages','Do not run runtime tests','Do not run tsc --noEmit']; const missing=required.filter((x)=>!m[0].includes(x)); if(missing.length){console.error('missing design-only rules: '+missing.join(', ')); process.exit(1)}" >> .omo/evidence/task-05-prompt-contract.txt`
  Commit: Y | `fix(prompt): define design-only contract`

- [x] 6. Establish the OpenCode-style DesignForge design system
  What to do / Must NOT do: Create/update `DESIGN.md` before UI rewrite. Implement JetBrains Mono and OpenCode-style tokens in global CSS. Avoid runtime CDN; prefer self-hosted WOFF2 or a local package already captured by lockfile changes.
  Parallelization: Wave C | Blocked by: 1 | Blocks: 7
  References: `C:\Users\CKIRUser\Downloads\DESIGN-opencode.ai.md`, `src/styles/globals.css`, `src/main.tsx`, optional `src/assets/fonts/jetbrains-mono/`
  Acceptance criteria: `DESIGN.md` exists. Global font stack starts with JetBrains Mono. CSS uses restrained ink/off-white/hairline tokens and no decorative gradients/orbs. No Berkeley Mono reference.
  QA scenarios:
  - happy: `rg -n "font-family|JetBrains|Berkeley|gradient|box-shadow|border-radius|#[0-9a-fA-F]{3,8}" DESIGN.md src/styles src > .omo/evidence/task-06-design-system.txt`
  - failure: `rg -n "Berkeley|Inter|SF Pro|Segoe UI|box-shadow|rounded-\\[18px\\]|rounded-lg|linear-gradient|radial-gradient" DESIGN.md src/styles src/App.tsx >> .omo/evidence/task-06-design-system.txt || true`; PASS iff occurrences are either removed or explicitly justified as non-dominant/manual legacy.
  Commit: Y | `style(ui): add opencode design system`

- [x] 7. Rebuild the app shell as a dense 3-pane workbench
  What to do / Must NOT do: Replace current broad dashboard with left command stream, center workbench plus fixed composer, and right inspector. Extract components only if needed to keep the rewrite maintainable.
  Parallelization: Wave C | Blocked by: 6 | Blocks: 8,9,11
  References: `src/App.tsx`, optional `src/components/workbench/*`, `src/styles/globals.css`
  Acceptance criteria: Desktop 1440x900 shows all three panes without overlap. Mobile 390x844 collapses to a usable stacked/tabbed workbench. Composer remains reachable and fixed/sticky in center workflow. No imagegen controls exist.
  QA scenarios:
  - happy: `npm run build > .omo/evidence/task-07-3pane-ui.txt`
  - failure: Start `npm run dev -- --host 127.0.0.1 --port 1420` in a background process, then run `powershell.exe -NoProfile -Command "$c=@($env:ProgramFiles+'\\Google\\Chrome\\Application\\chrome.exe',${env:ProgramFiles(x86)}+'\\Google\\Chrome\\Application\\chrome.exe',$env:LOCALAPPDATA+'\\Google\\Chrome\\Application\\chrome.exe')|Where-Object{Test-Path $_}|Select-Object -First 1; if(!$c){throw 'Chrome not found'}; & $c --headless=new --disable-gpu --window-size=1440,900 --screenshot='.omo/evidence/workbench-desktop.png' 'http://127.0.0.1:1420'; & $c --headless=new --disable-gpu --window-size=390,844 --screenshot='.omo/evidence/workbench-mobile.png' 'http://127.0.0.1:1420'; if(!(Test-Path '.omo/evidence/workbench-desktop.png') -or !(Test-Path '.omo/evidence/workbench-mobile.png')){exit 1}"`; append process PID and cleanup receipt to `.omo/evidence/task-07-3pane-ui.txt`.
  Commit: Y | `feat(ui): introduce three-pane workbench`

- [x] 8. Add selection-ready preview and composer-linked component editing
  What to do / Must NOT do: Add a manual action that starts preview for component selection only. Selection state must appear beside the fixed composer and automatically feed the next design prompt. Do not make normal design runs start preview.
  Parallelization: Wave D | Blocked by: 4,7 | Blocks: 9,11
  References: `src/App.tsx`, preview iframe helpers, `ensurePreviewSelectionBridge`, `previewFrameSrc`, selected component state
  Acceptance criteria: User can click component, see selected target near composer, and send edit intent without switching panels. If bridge cannot map DOM nodes, fallback anchor list is available.
  QA scenarios:
  - happy: `rg -n "selectionMode|previewFrameSrc|selectedComponent|ensurePreviewSelectionBridge|composer" src > .omo/evidence/task-08-selection-composer.txt`
  - failure: With the dev server from task 7 running, run `rg -n "selection-ready|선택.*preview|selectedComponent|previewSelection|componentEdit|runComponentEdit" src/App.tsx >> .omo/evidence/task-08-selection-composer.txt`; then capture `.omo/evidence/workbench-selection.png` with Chrome headless at 1440x900. PASS iff the surface includes a manual selection-ready action and selected context/composer code path is present without normal design-run preview start.
  Commit: Y | `feat(edit): connect selection context to composer`

- [x] 9. Demote runtime tooling to explicit manual controls
  What to do / Must NOT do: Move preview, verify, capture, critique, quality, repair, export into explicit manual controls. Critique/quality must not silently auto-capture or auto-verify.
  Parallelization: Wave D | Blocked by: 3,4,8 | Blocks: 11
  References: `src/App.tsx`, manual action handlers and UI copy
  Acceptance criteria: Normal send action never invokes runtime tools. Manual tools are visible but secondary. If a manual tool needs screenshot/logs and none exist, it asks for manual capture or uses existing artifacts only.
  QA scenarios:
  - happy: `rg -n "runManualCapture|runManualCritique|runManualQuality|runManualRepair|runManualExport|verifyWorkspace|startPreviewSafely" src/App.tsx > .omo/evidence/task-09-manual-tools.txt`
  - failure: `rg -n "await runManualCapture\\(|await runManualCritique\\(|await runManualQualityAudit\\(|await verifyWorkspace\\(|await startPreviewSafely\\(" src/App.tsx >> .omo/evidence/task-09-manual-tools.txt`; PASS iff normal design handlers do not call runtime tools and manual critique/quality do not auto-capture or auto-verify.
  Commit: Y | `fix(workflow): make runtime tools manual`

- [ ] 10. Write embedded Image Workspace architecture contract
  What to do / Must NOT do: Create a detailed internal architecture doc for the later ima2-gen-inspired image rebuild. Do not implement UI, disabled panels, or external service launch in this wave.
  Parallelization: Wave E | Blocked by: 2,5 | Blocks: 11
  References: `.omo/research/ima2-gen/`, new `docs/image-workspace-architecture.md` or `.omo/plans/image-workspace-architecture.md`
  Acceptance criteria: Contract covers design-context extraction, prompt enhancer pipeline, provider abstraction, API-key boundary, job queue/progress/history, asset library, insert-into-selected-slot flow, cancellation, and performance budget.
  QA scenarios:
  - happy: `rg -n "ima2|prompt enhancer|provider|history|queue|embedded|external service|selected design|performance" docs .omo/plans > .omo/evidence/task-10-image-workspace-contract.txt`
  - failure: `test -s docs/image-workspace-architecture.md && rg -n "embedded|prompt enhancer|provider abstraction|job queue|history|selected design slot|performance budget|not an external service|no disabled image UI" docs/image-workspace-architecture.md >> .omo/evidence/task-10-image-workspace-contract.txt`; PASS iff every required contract term is present and `rg -n "Image Workspace|coming soon|disabled image" src/App.tsx` returns no exposed product UI.
  Commit: Y | `docs(image): plan embedded workspace`

- [ ] 11. Final QA and regression sweep
  What to do / Must NOT do: Run the final verification set and inspect evidence for contradictions. Do not declare complete if imagegen references remain active or default path still starts runtime work.
  Parallelization: Final Wave | Blocked by: 2-10 | Blocks: final report
  References: whole repo
  Acceptance criteria: DesignForge product build/check passes, Rust check passes, `rg` checks confirm removal/no hidden install, browser QA confirms 3-pane/fixed composer/no imagegen controls.
  QA scenarios:
  - happy: `npm run build > .omo/evidence/task-11-final-qa.txt`
  - happy: `cargo check --manifest-path src-tauri/Cargo.toml >> .omo/evidence/task-11-final-qa.txt`
  - failure: `rg -n "\$imagegen|runImageGenerationRequest|buildImageGenerationPrompt|isImageGenerationRequest|IMAGE_PROMPT_PATH|generated-images" src src-tauri >> .omo/evidence/task-11-final-qa.txt || true`
  - failure: `rg -n "ensure_workspace_dependencies|arg\(\"install\"\)" src-tauri/src src >> .omo/evidence/task-11-final-qa.txt || true`
  - visual: `test -s .omo/evidence/workbench-desktop.png && test -s .omo/evidence/workbench-mobile.png && printf "screenshots: desktop+mobile present\n" >> .omo/evidence/task-11-final-qa.txt`; PASS iff both screenshot files exist and the QA notes in `task-07-3pane-ui.txt` say 3-pane desktop, fixed composer, no image generation controls, and no text overlap.
  Commit: N

## Final verification wave
> Runs after all todos. All checks must pass or be explicitly reported as blocked.
- [ ] F1. Plan compliance audit: every Must have and Must NOT have has matching evidence.
- [ ] F2. Code quality review: no unrelated refactor, no dead imagegen path, no hidden runtime chain.
- [ ] F3. UI visual QA: desktop and mobile screenshots show dense 3-pane/OpenCode direction, fixed composer, no clipped text.
- [ ] F4. Scope fidelity: normal design generation stops at design/static metadata; user-triggered manual tools remain separate.

## Commit strategy
- Commit 1: `refactor(image): remove current generation flow`
- Commit 2: `fix(pipeline): stop design runs before runtime checks`
- Commit 3: `fix(prompt): define design-only contract`
- Commit 4: `fix(runtime): stop implicit dependency install`
- Commit 5: `style(ui): add opencode design system`
- Commit 6: `feat(ui): introduce three-pane workbench`
- Commit 7: `feat(edit): connect selection context to composer`
- Commit 8: `docs(image): plan embedded workspace`
- If the repo remains non-git, treat this as review grouping rather than actual commits.

## Success criteria
- Current image generation is gone from active code and UI.
- Normal design generation is fast and design-only: no auto preview, capture, runtime test, install, export, repair, or `tsc --noEmit`.
- UI is a JetBrains Mono, OpenCode-style 3-pane workbench.
- Component selection/editing happens in the same center workbench flow as the composer.
- Runtime tools are explicit manual actions only.
- Future ima2-gen-inspired image generation has a concrete embedded architecture plan without shipping unfinished UI.
