# DesignForge Diff v2

작성일: 2026-07-05

## 요약

이번 업데이트의 목적은 DesignForge를 "자연어 요청을 받아 하나의 강한 디자인 산출물을 만드는 로컬 디자인 워크벤치"에 더 가깝게 만드는 것이다. 이전 `diff.md`에서 남았던 3안 비교 생성, 소스 근거 부족, token/component 구조화 부족, low-cost 검증 부족, handoff 근거 부족, 프로젝트 탐색 UX 부족을 중심으로 다시 점검했다.

결론:

- 3안 비교 생성 모드와 관련 UI/문구는 제거했다. 생성 흐름은 guided 단일 산출물 중심으로 정리했다.
- 채팅 첨부파일을 이미지/텍스트/Markdown/기타 파일까지 저장하고, prompt/context/chat history에 source material로 반영한다.
- `.designforge/tokens.json`을 생성해 color, typography, spacing/radius/shadow class, component anchor inventory를 구조화한다.
- `.designforge/static-check.json`을 생성해 default export, screen label, comment anchor, duplicate anchor, filler marker를 빠르게 검사한다.
- 프로젝트 패널에 프로젝트 이름 입력과 최근 프로젝트 검색을 추가했다.
- 명확한 anchored text replacement는 Codex 호출 전에 direct source splice로 처리한다.
- handoff/export는 token/static/attachment evidence를 포함한다.

## claude-design.md 재검토 반영

`claude-design.md`의 핵심은 도구 문법 자체가 아니라 의사결정 규칙이다. 이번 v2에서는 다음 원칙을 DesignForge 방식으로 번역했다.

1. 새 작업은 질문과 맥락 해석이 먼저다.
2. 제공된 code/assets/design system/attachments는 source truth다.
3. 작은 수정은 전체 재생성보다 좁은 source edit가 우선이다.
4. comment anchor와 screen label은 반복 수정의 핵심 계약이다.
5. filler content, fake metrics, generic AI trope는 품질 저하다.
6. 브랜드가 없을수록 의식적인 aesthetic direction이 필요하다.
7. token, component inventory, interaction state는 handoff 가능한 근거로 남아야 한다.
8. 사용자가 깨진 화면을 보지 않도록 검증 루프가 있어야 한다.
9. handoff 문서는 구현자가 대화 없이도 재현할 수 있어야 한다.
10. DesignForge 런타임은 React/Tailwind/Vite이므로 Claude Design Component 규칙은 그대로 복제하지 않고 manifest, prompt, source edit, preview evidence로 번역한다.

## 구현된 업데이트

- `src/App.tsx`
  - 파일 첨부 UI와 `.designforge/attachments.json` 저장/로드 추가.
  - 첨부파일을 chat message, clarification, generation prompt에 연결.
  - `writeTokenManifest` 추가: `DESIGN.md`, `src/styles.css`, `src/generated/Screen.tsx`에서 token/component evidence 추출.
  - `writeStaticCheckManifest` 추가: 생성물의 빠른 정적 품질 체크 기록.
  - 프로젝트 이름 입력과 프로젝트 검색 추가.
  - `runDirectSourceSplice` 추가: selected anchor 내부에서 exact text replacement가 유일할 때 Codex 없이 직접 수정.
  - generation 이후와 수동 repair/critique/quality/export 이후 token/static manifest 재생성.

- `src/lib/prompt-template.ts`
  - 3안/variation 전제를 제거하고 one strong artifact 중심으로 정리.
  - required reading에 `.designforge/tokens.json`, `.designforge/static-check.json`, attached files를 추가.
  - source truth, attachment integrity, anchors, handoff 중심으로 프롬프트 강화.

- `src/types.ts`
  - `AttachmentInfo`, `DesignTokenManifest`, `StaticCheckManifest` 추가.
  - context/run record에 token/static manifest path와 status 추가.

- `src-tauri/src/main.rs`
  - `write_binary_file` 추가로 이미지/바이너리 첨부 저장 지원.
  - 새 프로젝트 기본 구조에 `.designforge/attachments/`, `attachments.json` 추가.
  - handoff export에 attachments 폴더, `tokens.json`, `static-check.json` 포함.

- `README.md`
  - 최신 기능, 워크스페이스 구조, 기본 실행 단계, 제한 사항 업데이트.

## diff.md 대비 해결된 항목

- 프로젝트 이름 UI: 프로젝트 패널에 이름 입력 추가.
- Project search: 프로젝트 패널 검색 추가.
- Token manifest: `.designforge/tokens.json` 생성 추가.
- Component inventory: token manifest 안에 anchor 기반 inventory 추가.
- Auto lightweight verification: `.designforge/static-check.json` 추가.
- Direct edit splice: exact anchored text replacement에 한해 Codex 전 source splice 추가.
- Better handoff: token/static/attachment evidence를 handoff/export에 포함.
- Source truth: attachments와 manifest를 prompt required reading에 추가.

## 남은 제한

- direct source splice는 현재 exact text replacement만 안전 적용한다. 색상/class replacement는 다음 단계가 맞다.
- static check는 빠른 소스 검증이다. 실제 화면의 overflow, contrast, pixel-level 문제는 preview/capture/quality audit이 여전히 필요하다.
- 프로젝트별 preview 서버는 여전히 단일 backend preview process 상태를 공유한다.
- token manifest는 소스 추출 기반이다. 완전한 design-system compiler나 specimen card 생성기는 아니다.

## 10회 이상 검증/검토 로그

1. `diff.md` 재검토: 이전에 남긴 부족 항목을 project name/search, token manifest, static verification, source splice, handoff 중심으로 재분류했다.
2. `claude-design.md` workflow/questions/verification 구간 재검토: 질문 우선, source exploration, ready-for-verification 철학을 DesignForge manifest/수동 검증 정책으로 번역했다.
3. `claude-design.md` content guidelines 재검토: filler/fake metrics/generic trope 금지를 prompt quality lens와 static-check marker에 반영했다.
4. `claude-design.md` frontend design 구간 재검토: bold aesthetic direction, typography/color/composition/motion 기준을 prompt와 `DESIGN.md` quality lens 유지 정책에 반영했다.
5. `claude-design.md` create design system 구간 재검토: tokens/components/assets/source manifest 요구를 `.designforge/tokens.json`으로 경량 구현했다.
6. `claude-design.md` handoff 구간 재검토: token, interaction, asset, file evidence를 `outputs/handoff/README.md`에 포함하도록 보강했다.
7. 3안/variation 제거 검색: `rg`로 `variations`, `variation`, `3안`, `setGenerationMode`, `selectGenerationMode` 잔존 여부를 확인했다. variation 생성 로직은 남아 있지 않다.
8. TypeScript 검증: `npm run typecheck` 통과.
9. Rust 컴파일 검증: `cargo check` 통과.
10. Frontend production build 검증: `npm run build` 통과.
11. Rust lint 검증: `cargo clippy --all-targets -- -D warnings` 통과.
12. Whitespace/patch 검증: `git diff --check` 통과.
13. 구현 위치 검증: `rg`로 `writeTokenManifest`, `writeStaticCheckManifest`, `runDirectSourceSplice`, `addPendingFiles`, project search/name state 위치를 확인했다.
14. Backend export 검증: `rg`로 `write_binary_file`, `copy_dir_if_exists`, `attachments.json`, `tokens.json`, `static-check.json` 등록 위치를 확인했다.
15. README 검증: `rg`로 README에 attachment, token/static check, direct source splice, project search 문서화가 반영됐는지 확인했다.

## 결론

DesignForge는 이제 3안 비교 생성 앱이 아니라, 사용자의 자연어/첨부파일/기존 프로젝트 맥락을 읽고 하나의 강한 React/Tailwind 디자인 산출물을 만드는 방향으로 정리됐다. `diff.md`에서 가장 큰 남은 과제로 적었던 구조화 evidence와 low-cost verification도 token/static manifest로 최소 구현됐다.
