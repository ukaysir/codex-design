# Design System

## Source Priority

claude-design.md is the primary behavior reference, translated here for a local React/Tailwind/Vite workspace.

## Request

Pending first chat request. DesignForge will infer product identity and design direction automatically.

## Assumptions

- The user expects DesignForge to analyze the request and existing design context before asking tailored questions.
- Missing context should be handled by practical assumptions recorded here.
- Generated output should be a credible high-craft first screen that can be refined through chat.

## Purpose

Define the product, audience, job-to-be-done, and screen role before coding.

## Tone

Pick a specific direction rather than a generic default: refined, brutal, editorial, industrial, playful, luxurious, utilitarian, cinematic, or another direction that fits the request.

## Differentiation

Name the one visual or interaction idea the user should remember.

## Visual Foundations

- Color: background, surface, text, accent, border, semantic states, and contrast notes.
- Typography: display/body/mono choices, scale, weights, line-height, and why they fit.
- Layout: grid, density, spacing rhythm, responsive behavior, and composition rules.
- Components: buttons, inputs, cards, navigation, feedback, empty states, and repeated patterns.
- Motion: what moves, why it moves, duration/easing, and reduced-motion behavior.
- Assets: real assets used or needed; do not invent logos or decorative replacements.

## Quality Bar

- Strong hierarchy: the primary message and action are obvious within five seconds.
- Specific aesthetic direction: the design should not read like a generic AI SaaS template.
- Useful content only: every section earns its place.
- System continuity: repeated controls, cards, spacing, type, and tone follow the same vocabulary.
- Implementation fidelity: responsive constraints, readable text, visible focus, and accessible controls.

## Design Quality Lenses

1. Request fit: identify artifact type, fidelity, audience, constraints, and option count.
2. Source truth: inspect assets, code, design systems, screenshots, and prior chat before inventing visual rules.
3. System first: lock purpose, tone, differentiation, typography, color, spacing, components, motion, and content rules before broad UI changes.
4. Content economy: every section earns its place; no filler, fake metrics, or unrequested material.
5. Visual distinctiveness: commit to a memorable aesthetic direction and avoid generic AI defaults.
6. Composition and scale: choose layout density, hierarchy, viewport, responsive behavior, and type scale intentionally.
7. Interaction realism: define hover, focus, active, loading, empty, error, validation, and navigation states when relevant.
8. Editability and anchors: preserve targeted edits, stable data-comment-anchor values, literal text, and semantic regions.
9. Asset integrity: use real provided assets, do not invent logos/icons, and avoid copyrighted recreation.
10. Verification and handoff: keep output previewable, record assumptions/caveats, and document exact implementation details.

## Interaction and State Model

- Define hover, active, focus, loading, empty, error, success, and disabled states when the surface implies product interaction.
- Prototype enough behavior to make the generated result feel real without making the code difficult to revise.
- Use motion for comprehension, rhythm, or state change and respect reduced-motion preferences.

## Responsive Rules

- Name the primary viewport and any fixed canvas requirement before coding.
- Ensure text, controls, and repeated items fit at desktop and narrower widths.
- Use stable flex/grid constraints, explicit gaps, and intentional density.

## Asset and Source Policy

- Use provided assets, code, or design-system evidence as source of truth.
- Do not invent logos, fake icons, fake metrics, or copyrighted UI details.
- If assets are missing, record assumptions and use neutral placeholders.

## Editability and Anchors

- Keep user-visible copy literal and directly editable where practical.
- Preserve existing data-comment-anchor values and add stable anchors for major semantic regions.
- For targeted edits, change only the requested region and preserve unrelated layout, spacing, type, colors, and copy.

## Component Inventory

Track stable semantic regions and keep them aligned with `data-comment-anchor` values in `src/generated/Screen.tsx`.

- navigation:
- hero:
- primary-action:
- feature-list:
- preview:
- footer:

## Revision Rules

- Continue inside this design system unless the user explicitly asks for a new direction.
- For a component-level request, edit only the matching anchor's semantic region.
- Preserve unrelated layout, spacing, typography, color, copy, and anchor ids.
- Record meaningful system changes here so future requests build on the same foundation.

## Content Rules

- No filler sections or lorem ipsum.
- No fake metrics unless the request provides real data or asks for sample data.
- Emoji only when appropriate to the product or provided brand.
- Copy should match the product tone and stay concise.

## Implementation Rules

- Main generated screen: src/generated/Screen.tsx.
- Keep high-level screen roots labelled with data-screen-label.
- Add stable data-comment-anchor values to important semantic regions.
- Preserve data-comment-anchor values during revisions.
- Change only requested areas for targeted edits.
- Use semantic HTML and accessible controls.
- Use flex/grid with gap for grouped UI.
- Update src/styles.css only for shared fonts, variables, keyframes, or global support.

## Anti-patterns

- Filler content
- Fake metrics
- Generic AI SaaS composition
- Emoji unless explicitly appropriate
- Decorative gradients without purpose
- Cards with only a colored left-border accent
- Unrelated shell/dependency changes

## Verification

The generated workspace should pass TypeScript and Vite build checks before preview. Record known caveats here.
