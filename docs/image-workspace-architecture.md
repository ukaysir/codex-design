# Image Workspace Architecture Contract

Task 10 defines the internal contract for a later ima2-gen-inspired image rebuild inside Codex Design. This document is intentionally architecture-only. This wave does not add product UI, disabled panels, external process launch, or provider calls.

## Product Boundary

The Image Workspace must be embedded in the existing Codex Design desktop app. It is not an external service, not a sidecar ima2 server, and not a wrapper that asks users to run another local web app. The future implementation may reuse functional patterns observed in `.omo/research/ima2-gen`, but those patterns must be translated into Codex Design's Tauri, React, and project-workspace model.

Non-goals for this wave:

- no disabled image UI in `src/App.tsx` or any exposed product route;
- no "coming soon" panel, menu item, empty tab, or placeholder affordance;
- no provider network call, API-key prompt, OAuth flow, CLI launch, or server process;
- no external service launcher for ima2-gen or any provider-specific runtime.

The first user-visible image feature should ship only when it can complete a real image task against the selected design slot. Until then, the contract lives in docs only.

## Reference Patterns From ima2-gen

The ima2-gen clone is a reference for functional shape, not copy text or code. Useful patterns to carry forward:

- Dashboard/history: separate browsing history from the active composer so passive selection does not mutate the prompt.
- Prompt studio/enhancer: keep a focused prompt enhancer that rewrites rough intent into provider-ready image prompts while preserving explicit user wording.
- Provider/adapters: hide provider-specific request payloads behind a provider abstraction so the rest of the app speaks one image job contract.
- Queue/progress/cancel: treat generation as a job queue with durable job ids, progress snapshots, and cancellation that can abort queued or running work.
- Asset metadata: persist generated/imported image metadata with enough prompt, provider, design context, and source-slot information to support reuse.

## Core Architecture

The future Image Workspace is a feature slice inside the DesignForge project workspace. It owns image-specific state, assets, prompts, and generation jobs, but it reads design context from the existing project manifest and selected preview element. It should not own Codex chat history, preview server lifecycle, app-server sessions, or design verification.

Required internal layers:

1. `design-context extraction`
   Reads the current project, selected design slot, visible screen, screenshot/capture metadata when available, design tokens, component labels, selected DOM anchor, and current user instruction. It returns a sanitized, serializable context object with no API keys and no raw private logs.

2. `prompt enhancer`
   Converts extracted design context plus user image intent into a generation prompt that matches the current design language. The enhancer should preserve explicit user constraints, reject unsupported hidden assumptions, and output structured fields such as subject, placement, style cues, palette, format, negative constraints, and slot fit.

3. `provider abstraction`
   Defines a provider-neutral adapter interface for generation, edit, reference-image, and cancellation. UI and project state must submit `ImageJobRequest` objects; only adapters translate them into provider-specific payloads.

4. `job queue`
   Stores queued, running, completed, failed, and canceled jobs per project. Each job has a stable id, request snapshot, selected design slot target, progress events, cancellation token, provider result metadata, and asset output links.

5. `asset library`
   Stores generated, imported, and inserted assets under the project workspace. Assets keep sidecar metadata and may later embed metadata in supported image files. The asset library is separate from chat history so image browsing never rewrites conversation state.

6. `history`
   Presents project-local generations and insertions as recoverable history. History must support filtering by project, screen, selected design slot, provider, prompt, and inserted/uninserted status.

## Design Context To Matching Image Prompts

The central contract is how Codex Design context becomes image prompts that match the current design language.

Input context should include:

- project title and active screen label;
- selected design slot id, selected DOM anchor, and component role;
- nearby text labels and layout purpose;
- existing style signals from `DESIGN.md`, generated component CSS, screenshot critique notes, and design tokens;
- palette, typography, density, radius, shadow, icon, and imagery conventions inferred from the current workspace;
- requested image role such as hero media, empty state, avatar, icon, card thumbnail, background texture, or product illustration;
- insertion constraints such as aspect ratio, transparent background, safe crop region, and max file size.

The prompt enhancer must transform that context into a prompt that is specific enough for image generation while still aligned with the design language. For example, if the selected design slot is a compact SaaS dashboard card, the enhanced prompt should bias toward restrained operational imagery, matching palette and density, and avoid unrelated cinematic or decorative output. If the slot is a first-viewport brand hero, the prompt should preserve product subject, composition, and responsive crop requirements.

The enhancer output should be deterministic enough to audit:

```ts
type EnhancedImagePrompt = {
  userIntent: string;
  designLanguageSummary: string;
  slotFit: {
    selectedDesignSlotId: string;
    role: "hero" | "card" | "icon" | "texture" | "avatar" | "inline" | "other";
    aspectRatio: string;
    insertionNotes: string[];
  };
  providerPrompt: string;
  negativePrompt?: string;
  references: ImageAssetRef[];
  auditNotes: string[];
};
```

The provider prompt must not include API keys, raw local paths outside the project, hidden app prompts, or private Codex transcripts. It may include design-context extraction summaries that are necessary for visual match.

## API-Key Boundary

The API-key boundary is below the provider abstraction and above provider network clients. The future UI can report provider readiness, but it must never expose, log, serialize into history, or embed keys in asset metadata. Keys should live in the existing secure configuration path for the app, not in project files. Project artifacts may store `providerId`, `model`, request id, elapsed time, prompt hash, and safe status fields, but never credentials.

Provider adapters must return typed errors for missing credentials, refused content, unsupported model, quota/rate limit, timeout, and cancellation. The queue and UI should consume those typed errors without parsing provider-specific text.

## Job Queue, Progress, And Cancellation

The job queue is the only path from Image Workspace intent to provider work. Direct provider calls from UI components are forbidden.

Required queue states:

- `queued`: request captured, not yet submitted;
- `enhancing`: prompt enhancer is deriving the provider prompt;
- `running`: provider adapter has accepted the request;
- `progress`: provider or adapter emitted progress; the latest progress snapshot is visible to the workspace;
- `completed`: asset saved and metadata committed;
- `failed`: terminal error with typed code and safe message;
- `canceled`: user cancellation or app shutdown canceled queued/running work.

Cancellation must work for both queued and running jobs. For queued jobs, cancellation removes or marks the job before provider submission. For running jobs, the queue must call the provider abstraction cancellation hook and record whether upstream abort was acknowledged. A canceled job must never be inserted into the selected design slot automatically.

Progress events must be scoped by job id and project id. The app should tolerate restart/reload by reconciling queue state from project metadata before rendering any run status.

## Insert-Into-Selected-Slot Flow

The insert-into-selected-slot flow is the first full workflow the later implementation must support.

1. User selects a design element or target media placeholder in the current preview.
2. `design-context extraction` records the selected design slot, screen, nearby copy, dimensions, style constraints, and insertion target.
3. User writes or chooses an image intent.
4. `prompt enhancer` produces an enhanced prompt and audit summary that explain why the image should fit the current design language.
5. The job queue submits an `ImageJobRequest` through the provider abstraction.
6. The adapter emits progress and terminal status.
7. The asset library stores the image and metadata.
8. The user explicitly inserts the asset into the selected design slot.
9. Codex Design applies the asset through the normal workspace editing path, preserving selected-slot intent and updating project files only after explicit insertion.
10. History records generation, insertion target, and resulting asset id.

No generation result may silently replace a design asset. Insert requires an explicit selected design slot and an explicit user action.

## Data Contracts

Draft request shape:

```ts
type ImageJobRequest = {
  projectId: string;
  selectedDesignSlotId: string;
  sourceScreenLabel: string;
  userIntent: string;
  enhancedPrompt: EnhancedImagePrompt;
  provider: {
    id: string;
    model?: string;
    quality?: "draft" | "standard" | "high";
  };
  output: {
    aspectRatio: string;
    format: "png" | "jpeg" | "webp";
    transparentBackground?: boolean;
    maxBytes?: number;
  };
  references: ImageAssetRef[];
};
```

Draft asset metadata:

```ts
type ImageAssetMetadata = {
  assetId: string;
  projectId: string;
  createdAt: string;
  source: "generated" | "imported" | "inserted";
  selectedDesignSlotId?: string;
  promptSummary?: string;
  enhancedPromptHash?: string;
  providerId?: string;
  model?: string;
  dimensions: { width: number; height: number };
  history: {
    jobId?: string;
    insertedAt?: string;
    insertedPath?: string;
  };
};
```

The final implementation may adjust exact type names, but it must preserve the boundaries: prompt data is separate from provider credentials, asset metadata is separate from chat records, and selected-slot insertion is separate from generation completion.

## Performance Budget

The performance budget exists because image work can easily block the design loop.

- Opening a project with image history should not block the main workspace on thumbnail hydration.
- The asset library should load summaries first and image bytes lazily.
- Prompt enhancement should run as a bounded job step with visible progress when it takes noticeable time.
- The queue should cap concurrent provider work per project and expose pending/running counts.
- Large image payloads must stay out of chat logs, app activity logs, and unbounded React state.
- Metadata extraction should use size caps and reject oversized inputs before decoding.
- The insert-into-selected-slot flow should update only the target asset reference and nearby code needed for that slot, not regenerate the full screen.

Initial target budgets for the later implementation:

- under 100 ms to render the workspace shell from cached summaries;
- under 250 ms to list the first page of history from project-local metadata;
- under 500 ms for design-context extraction on a normal generated workspace;
- no base64 image payloads persisted in long-lived UI state after asset save;
- no provider request on the UI thread.

## Safety And Observability

Logs may include job id, project id, selected design slot id, provider id, model, elapsed time, byte counts, dimensions, status code, and typed error code. Logs must not include raw API keys, OAuth tokens, private prompt history, raw generated base64, or raw upstream responses.

Observable events should be safe and compact:

- prompt enhancement started/completed/failed;
- provider job queued/running/progress/completed/failed/canceled;
- asset saved/imported/inserted/deleted;
- insertion applied to selected design slot;
- history reconciled after restart.

## Acceptance Contract For Later Waves

Future implementation work must preserve this contract:

- Image Workspace remains embedded and not an external service.
- No disabled image UI ships as a placeholder.
- Provider calls go through the provider abstraction.
- Every generation goes through the job queue.
- Prompt generation uses design-context extraction and a prompt enhancer.
- Generated assets land in the asset library before insertion.
- History is project-local and separate from chat history.
- Insert requires an explicit selected design slot.
- Progress and cancellation are first-class job behavior.
- The API-key boundary prevents credentials from entering project files, metadata, history, or logs.
- The performance budget is verified with real project data before UI exposure.
