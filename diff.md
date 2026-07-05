# claude-design.md vs DesignForge Diff Report

작성일: 2026-07-05

## 요약

DesignForge의 목표는 사용자가 자연어로 디자인을 요청하면 AI가 맥락을 읽고, 디자인 시스템을 만들거나 이어받고, 고품질 React/Tailwind 화면을 생성하며, 이후 채팅으로 계속 개선하는 것이다.

`claude-design.md`는 이 목표에 필요한 핵심 원칙을 이미 갖고 있다. 중요한 차이는 런타임이다. Claude Design은 Design Component, 전용 도구, 질문 도구, verifier, canvas/deck/doc/export 도구를 전제로 한다. DesignForge는 로컬 Tauri + React/Tailwind + Vite + Codex CLI 워크스페이스를 전제로 한다. 따라서 DesignForge는 도구 문법을 복제하지 않고, 의사결정 로직과 품질 기준을 React/Tailwind 프로젝트 구조로 번역해야 한다.

이번 구현에서는 가장 중요한 누락점 두 가지를 보강했다.

- 프로젝트 격리: 새 디자인은 기존 기록 삭제가 아니라 새 프로젝트 디렉토리 생성이다.
- 디자인 품질 루프: `claude-design.md`를 10개 품질 렌즈로 재구성해 preflight, prompt, `DESIGN.md`, health gate, quality audit에 반복 적용한다.

## 섹션별 비교

### 1. Workflow

`claude-design.md`는 새 작업에서 요구사항, fidelity, 옵션 수, 제약, 디자인 시스템/브랜드를 먼저 이해하고 필요하면 질문한다. DesignForge도 AI preflight와 `clarification.json`을 갖고 있지만, 기존에는 질문 범위가 4-8개 중심이고 품질 관점이 흩어져 있었다.

보강:

- broad/new 프로젝트는 6-10개 질문을 선호하도록 변경했다.
- 질문 기준을 audience, source truth, visual direction, content proof, interaction states, assets, density, variation axis, responsive target, editability, handoff까지 확장했다.

### 2. Resource Exploration

Claude Design은 코드, 디자인 시스템, UI kit, 자산을 먼저 탐색하고 그것을 소스로 삼는다. DesignForge는 `context.json`으로 assets/styles/source/generated artifact/anchors를 요약하지만, “source truth”가 명시적인 품질 게이트는 약했다.

보강:

- 10개 품질 렌즈 중 `Source truth`와 `Asset integrity`를 추가했다.
- `DESIGN.md` seed와 starter workspace instructions에 제공 자산/코드/디자인 시스템을 우선 소스로 삼도록 명시했다.

### 3. Output Discipline

Claude Design은 작은 수정이면 정확히 그 부분만 고치고, 큰 변경이면 복사/새 버전/새 방향을 명확히 한다. DesignForge는 anchor 기반 targeted edit와 `<mentioned-element>` 변환이 이미 있지만, 새 디자인 시작이 현재 워크스페이스를 초기화하는 흐름과 충돌했다.

보강:

- `새 디자인 시작`을 `새 프로젝트 만들기`로 전환했다.
- 기존 프로젝트의 채팅, 작업 기록, `DESIGN.md`, 생성 결과물은 유지된다.
- 프로젝트 패널에서 이전 프로젝트를 클릭하면 해당 디렉토리로 다시 전환한다.

### 4. Comments And Anchors

Claude Design은 comment anchor와 screen label을 보존한다. DesignForge도 `data-comment-anchor`, `data-screen-label`, preview selection bridge, `anchors.json`을 갖고 있어 방향은 맞다.

부족점:

- anchor가 없는 생성물의 직접 선택 UX는 아직 제한적이다.
- 단순 텍스트/색상 수정도 여전히 Codex를 거치는 경우가 많다.

권장 업그레이드:

- anchor 누락 감지와 자동 보강 경고를 추가한다.
- 단순 anchored edit는 Codex 호출 전에 안전한 source splice를 먼저 시도한다.

### 5. Content Guidelines

Claude Design은 filler, fake metrics, 불필요한 섹션, emoji-by-default, generic AI trope를 강하게 금지한다. DesignForge도 anti-slop 규칙은 있었지만, 품질 감사가 구체적인 content economy 관점으로 반복되지는 않았다.

보강:

- `Content economy` 렌즈를 추가했다.
- 품질 감사가 10개 렌즈와 hierarchy/type/color/accessibility/implementation fidelity를 함께 채점하도록 바뀌었다.

### 6. Frontend Design

Claude Design은 브랜드가 없을 때 bold aesthetic direction, 목적, 톤, 차별점, typography, color, motion, spatial composition을 먼저 정하라고 한다. DesignForge는 `DESIGN.md`에 Purpose/Tone/Differentiation/Visual Foundations가 있었지만, “매번 10회 이상 재검토되는 품질 루프”로는 연결되지 않았다.

보강:

- `Design Quality Lenses` 섹션을 `DESIGN.md` seed와 starter `DESIGN.md`에 추가했다.
- broad change 전에는 10개 렌즈 결정을 `DESIGN.md`에 기록하도록 prompt에 추가했다.

### 7. Interactive Prototype

Claude Design은 인터랙티브 프로토타입이면 hover/click/form/validation/multi-step/state transition이 실제 제품처럼 느껴져야 한다고 한다. DesignForge는 React를 사용하므로 이 방향을 구현할 수 있지만, 기존 `DESIGN.md` health gate는 상태 모델을 별도 섹션으로 보지 않았다.

보강:

- `Interaction and State Model` 섹션을 health gate와 seed에 추가했다.
- hover/active/focus/loading/empty/error/success/disabled 상태를 명시하도록 했다.

### 8. Design System Creation

Claude Design의 design-system 섹션은 tokens, typography, colors, assets, components, UI kits, guidelines, source manifest를 매우 구체적으로 요구한다. DesignForge의 `DESIGN.md`는 경량 문서라 전체 design system folder compiler는 없다.

현재 차이:

- DesignForge는 단일 프로젝트의 `DESIGN.md` 중심이다.
- Claude Design은 별도 디자인 시스템 프로젝트와 reusable components/cards/UI kits까지 가진다.

권장 업그레이드:

- `DESIGN.md`에서 추출 가능한 token manifest를 `.designforge/tokens.json`으로 생성한다.
- 생성 화면의 component inventory와 anchors를 `DESIGN.md`에 자동 반영한다.
- 추후 UI kit/starting point 개념을 `artifacts/` 아래에 확장한다.

### 9. Verification And Handoff

Claude Design은 ready_for_verification과 verifier를 중심으로 사용자가 깨진 화면을 보지 않게 한다. DesignForge는 비용을 줄이기 위해 verification/preview/capture/critique/audit/export를 manual action으로 둔다. 이 정책은 제품상 합리적이지만, 기본 생성 직후 품질 확신은 Claude Design보다 약하다.

현재 차이:

- DesignForge는 기본 생성에서 자동 검증을 하지 않는다.
- 대신 사용자가 수동으로 검증, preview, capture, critique, quality audit, export를 실행한다.

권장 업그레이드:

- 빠른 정적 검증만 선택적으로 자동 실행하는 low-cost gate를 추가한다.
- quality audit 결과를 run record summary에 더 강하게 노출한다.

### 10. Project Memory

Claude Design의 프로젝트는 파일 시스템과 persistent instructions를 중심으로 이어진다. DesignForge도 파일 기반이지만 기존에는 새 디자인 시작이 현재 workspace를 초기화해 기억을 파괴했다.

보강:

- `create_project` / `list_projects` 백엔드 명령을 추가했다.
- `.designforge/project.json`, `.designforge/chat.jsonl`, `.designforge/activity.jsonl`, `.designforge/runs.jsonl`이 프로젝트별로 유지된다.
- 프로젝트 목록 side panel에서 이전 프로젝트로 돌아갈 수 있다.

## 10회 이상 탐구 로그

1. Workflow 관점: 새/모호한 요청은 질문과 목표 정의가 먼저여야 한다.
2. Resource 관점: code/assets/design-system을 source truth로 삼아야 한다.
3. Targeted edit 관점: 작은 요청은 정확히 그 범위만 수정해야 한다.
4. Anchor 관점: `data-comment-anchor`와 screen label이 대화형 반복의 핵심이다.
5. Content 관점: filler와 fake metrics는 디자인 품질을 직접 떨어뜨린다.
6. Aesthetic 관점: 브랜드가 없으면 bold direction을 의식적으로 선택해야 한다.
7. Composition 관점: viewport, type scale, density, responsive behavior가 설계값이어야 한다.
8. Interaction 관점: 실제 제품처럼 state와 feedback을 포함해야 한다.
9. Asset/IP 관점: 로고, 아이콘, 브랜드 UI를 임의로 만들거나 베끼면 안 된다.
10. Verification/Handoff 관점: 결과가 previewable하고 구현 가능한 증거를 남겨야 한다.
11. Project memory 관점: 새 작업은 삭제가 아니라 새 디렉토리와 지속 가능한 맥락이어야 한다.
12. Design-system 관점: `DESIGN.md`는 단순 노트가 아니라 다음 실행의 품질 계약이어야 한다.

## 이번에 구현된 업그레이드

- 새 프로젝트 생성:
  `create_project(projectRootPath, name)`가 내부 `designforge-workspace` 아래에 새 프로젝트 디렉토리를 만든다.

- 프로젝트 목록:
  `list_projects(projectRootPath)`가 기존 legacy root 프로젝트와 새 child project를 읽고 최신순으로 정렬한다.

- 프로젝트 전환 UI:
  folder icon으로 side panel을 열고, 이전 프로젝트를 클릭하면 해당 디렉토리를 열어 기존 맥락을 이어간다.

- 기록 분리:
  사용자/assistant 대화는 `.designforge/chat.jsonl`, status/tool 작업 로그는 `.designforge/activity.jsonl`에 저장한다.

- 중첩 프로젝트 보호:
  파일 색인은 `.git`, `node_modules`, `target`, `dist`뿐 아니라 nested DesignForge project directory도 스킵한다.

- 10-lens design loop:
  `prompt-template.ts`, `DESIGN.md` seed, starter workspace `DESIGN.md`, health gate, preflight prompt, quality audit prompt에 10개 품질 렌즈를 반영했다.

## 아직 부족한 점

- 프로젝트 이름을 사용자가 직접 입력하는 UI가 없다. 지금은 “Untitled DesignForge Project” 또는 첫 요청 기반 이름으로 생성된다.
- 프로젝트 루트 설정 UI가 없다. `defaultProjectRootDir` 타입은 추가됐지만 설정 화면은 아직 없다.
- 프로젝트별 preview 서버는 여전히 하나의 backend preview process 상태를 공유한다. 전환 시 preview를 멈추도록 했지만, 여러 프로젝트 동시 preview는 아니다.
- `DESIGN.md`의 token/component inventory를 자동으로 구조화된 JSON으로 뽑지는 않는다.
- 자동 시각 검증은 manual action이다. 품질은 prompt/audit으로 강화됐지만, 기본 생성 뒤 즉시 screenshot verifier가 도는 구조는 아니다.
- 단순 source splice edit가 없어 작은 copy/color 수정도 Codex 경로를 탈 수 있다.

## 다음 업그레이드 제안

1. 프로젝트 생성 모달
   - 프로젝트 이름, 목적, surface, target viewport를 입력받아 `.designforge/project.json`과 초기 `DESIGN.md`에 반영한다.

2. Design token manifest
   - `DESIGN.md`와 generated CSS/TSX에서 colors, type scale, spacing, radius, shadow를 추출해 `.designforge/tokens.json`을 만든다.

3. Direct edit splice
   - `@anchor`의 단순 text/color/class 변경은 Codex 없이 source-level patch로 처리하고 run record에 기록한다.

4. Quality checklist UI
   - 10개 렌즈별 상태를 brief/quality panel에 표시하고, 빠진 렌즈를 클릭하면 해당 질문 또는 audit을 실행한다.

5. Auto lightweight verification
   - 기본 생성 직후 TypeScript AST/import check 정도만 빠르게 실행하고, Vite build/screenshot은 계속 수동으로 둔다.

6. Project search
   - 프로젝트 패널에서 최근 메시지, run request, `DESIGN.md` title을 검색한다.

7. Better handoff
   - 10개 렌즈 결과, tokens, interaction states, responsive assumptions를 handoff README에 구조적으로 추가한다.

8. Multi-artifact evolution
   - 현재 `screen` 하나에서 시작하지만, deck/doc/prototype/export artifact를 프로젝트별로 추가 관리한다.

## 결론

DesignForge는 이제 “한 워크스페이스를 계속 지우며 새 디자인을 시작하는 앱”이 아니라 “프로젝트별 기억을 유지하면서 자연어 요청을 디자인 품질 루프로 통과시키는 로컬 디자인 생성 워크벤치”에 가까워졌다.

가장 큰 남은 과제는 생성된 디자인 자체를 더 정량적으로 점검하는 UI와 token/component 구조화다. 이번 변경은 그 기반이 되는 프로젝트 격리와 10-lens 품질 로직을 먼저 구현한 것이다.
