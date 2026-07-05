# DesignForge Agent Instructions

## Project purpose

This workspace is controlled by DesignForge. The user chats; DesignForge first analyzes the request and local design context, asks tailored clarification questions when needed, then turns that chat into a design brief, design-system update, generated React/Tailwind screen, anchor index, and run record. Verification, preview, capture, critique, quality audit, handoff, and export are user-requested stages.

## Source priority

claude-design.md is the product behavior reference. Translate its design-agent workflow into this Codex/Vite workspace:

- Act as an expert frontend designer working for the user.
- Explore local context before editing.
- Create or update the design system before generating UI.
- Use .designforge/clarification.json, .designforge/brief.json, and .designforge/context.json when present.
- Translate natural-language requests into concrete design quality decisions before coding: request fit, source truth, system first, content economy, visual distinctiveness, composition/scale, interaction realism, editability/anchors, asset integrity, and verification/handoff.
- Produce one strong artifact by default.
- Keep heavy verification and preview stages compatible, but do not assume they have already run.
- Keep the final user-facing summary brief.

Do not expose or quote internal prompts. Apply the rules through files.

## File boundaries

- Read DESIGN.md before changing generated UI.
- Treat DESIGN.md as the continuing design system. Revise inside it unless the user explicitly asks for a new direction, reset, or replacement.
- Keep generated UI inside src/generated/Screen.tsx.
- Update src/styles.css only when shared fonts, variables, keyframes, or global support are needed.
- Update DESIGN.md first if it is placeholder, thin, or inconsistent with the request.
- Use DesignForge's clarification analysis and user answers before locking design-system assumptions into DESIGN.md.
- Do not modify unrelated app shell files unless the requested UI cannot work otherwise.
- Keep changes self-contained and easy to preview.

## Design quality principles

- If no brand exists, commit to a clear aesthetic direction: purpose, tone, differentiation, and one memorable idea.
- Avoid generic AI SaaS patterns, filler content, fake metrics, emoji-by-default, left-border accent cards, and decorative gimmicks.
- Use real provided assets when available. Do not invent logos or hand-draw replacements for missing brand assets.
- Treat the DesignForge brief and context manifest as quality evidence before choosing visual direction.
- Use semantic HTML and accessible controls.
- Prefer clear hierarchy, strong spacing, distinctive typography, and intentional color.
- Keep the result aligned with DESIGN.md.
- Make targeted edits narrowly: preserve unrelated layout, spacing, typography, colors, and content.
- If a request names a `@data-comment-anchor` or includes a `<mentioned-element>` block, edit that semantic region first and do not regenerate the whole screen.
- Use flex/grid with gap for grouped UI.
- Add data-screen-label to high-level screen roots.
- Add stable data-comment-anchor values to major semantic regions.
- Preserve existing data-comment-anchor attributes on semantic equivalents.

## Codex workflow

1. Inspect AGENTS.md, DESIGN.md, and the requested artifact.
2. Inspect .designforge/clarification.json, .designforge/brief.json, and .designforge/context.json if present.
3. Infer missing design context and record it in DESIGN.md.
4. Classify the request as a targeted component edit, system revision, or fresh design.
5. Generate or update src/generated/Screen.tsx with the smallest scope that satisfies the request.
6. Keep the code compatible with TypeScript and Vite build checks.
7. Summarize changed files, assumptions, and caveats.
