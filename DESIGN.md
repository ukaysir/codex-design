# DesignForge Design System

## 1. Atmosphere & Identity

DesignForge should feel like a dense terminal workbench: direct, inspectable, and built for repeated use by people steering design agents. The signature is a cream command canvas with ink-first mono typography, hairline panels, ASCII-like labels, and one dark TUI surface for runtime output. The interface avoids decorative polish; clarity comes from typed structure, restrained contrast, and precise state color.

## 2. Color

### Palette

| Role | Token | Light | Dark | Usage |
|------|-------|-------|------|-------|
| Surface/page | `--bg` | `#fdfcfc` | `#201d1d` | App body and primary canvas |
| Surface/canvas | `--canvas` | `#fdfcfc` | `#201d1d` | Main work area |
| Surface/panel | `--panel` | `#fdfcfc` | `#302c2c` | Primary panels |
| Surface/soft | `--panel-2` | `#f8f7f7` | `#302c2c` | Secondary rows, inputs |
| Surface/card | `--panel-3` | `#f1eeee` | `#302c2c` | Inset snippets, disabled fills |
| Border/hairline | `--line` | `rgba(15, 0, 0, 0.12)` | `rgba(253, 252, 252, 0.16)` | Default 1px separators |
| Border/strong | `--line-strong` | `#646262` | `#9a9898` | Active dividers and selected edges |
| Text/primary | `--ink` | `#201d1d` | `#fdfcfc` | Primary text |
| Text/strong | `--ink-strong` | `#0f0000` | `#ffffff` | Emphasis and pressed ink |
| Text/body | `--charcoal` | `#302c2c` | `#f1eeee` | Body text with slightly softer weight |
| Text/muted | `--muted` | `#646262` | `#c8c4c4` | Secondary labels |
| Text/faint | `--mute` | `#9a9898` | `#9a9898` | Disabled, hints, timestamps |
| Action/primary | `--primary` | `#201d1d` | `#fdfcfc` | Primary buttons and selected actions |
| Action/pressed | `--primary-strong` | `#0f0000` | `#f1eeee` | Active primary state |
| Action/on-primary | `--on-primary` | `#fdfcfc` | `#201d1d` | Text on primary fill |
| TUI/accent | `--accent` | `#007aff` | `#5eb1ff` | Informational TUI syntax only |
| State/warning | `--warning` | `#ff9f0a` | `#ffbd45` | Caution states |
| State/danger | `--danger` | `#ff3b30` | `#ff6961` | Error and destructive states |
| State/success | `--success` | `#30d158` | `#62e27b` | Success states |
| TUI/dark | `--surface-dark` | `#201d1d` | `#0f0000` | Terminal preview and runtime output |
| TUI/on-dark | `--on-dark` | `#fdfcfc` | `#fdfcfc` | Text on dark surfaces |
| TUI/on-dark-muted | `--on-dark-muted` | `rgba(253, 252, 252, 0.68)` | `rgba(253, 252, 252, 0.68)` | Secondary dark-surface text |

### Rules

- Cream, ink, and warm gray carry the chrome. Blue, orange, red, and green are reserved for TUI syntax, status, and feedback.
- No decorative color blends, glow fields, or color washes.
- New colors must become semantic tokens here before entering CSS or JSX.

## 3. Typography

### Scale

| Level | Size | Weight | Line Height | Tracking | Usage |
|-------|------|--------|-------------|----------|-------|
| Display | 38px | 700 | 1.5 | 0 | Product title or one page-level command header |
| H1 | 24px | 700 | 1.45 | 0 | Workbench section title |
| H2 | 18px | 700 | 1.5 | 0 | Panel title |
| H3 | 16px | 700 | 1.5 | 0 | Row group title, stage label |
| Body | 16px | 400 | 1.5 | 0 | Default text and chat content |
| Body/strong | 16px | 500 | 1.5 | 0 | Active nav, labels, inline emphasis |
| Button | 16px | 500 | 2 | 0 | Button labels and compact commands |
| Caption | 14px | 400 | 2 | 0 | Metadata, footer, timestamps |
| Micro | 12px | 500 | 1.5 | 0 | Dense badges and table metadata |

### Font Stack

- Primary and mono: `"JetBrains Mono", "IBM Plex Mono", ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`
- Use the same monospaced family for every visible text role.
- Do not introduce a proportional body, display, or UI face.

### Rules

- Letter spacing is always `0`.
- Body text stays at 14px or larger.
- Hierarchy comes from weight, size, borders, and position, not family changes.

## 4. Spacing & Layout

### Base Unit

All spacing derives from a 4px base.

| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | 4px | Tight inline gaps, button vertical padding |
| `--space-2` | 8px | Dense list rows, icon-to-label spacing |
| `--space-3` | 12px | Input padding, compact panel padding |
| `--space-4` | 16px | Default panel padding |
| `--space-5` | 20px | Button horizontal padding |
| `--space-6` | 24px | Larger panel groups |
| `--space-8` | 32px | Workbench column gutters |
| `--space-12` | 48px | Major vertical breaks |
| `--space-16` | 64px | Large TUI preview padding |
| `--space-24` | 96px | Maximum section rhythm |

### Grid

- Max workbench content width is governed by the desktop shell, with dense panels allowed to fill available space.
- Panel layouts use fixed tool rails, resizable work areas, and scrollable panes rather than floating cards.
- Breakpoints: 640px, 768px, 1024px, 1280px, 1536px. The desktop app may retain a wide minimum where workflow density requires it.

### Rules

- Prefer full-height panes, table-like rows, and split panels over marketing cards.
- Panel padding defaults to 12px or 16px.
- Values outside the spacing scale require a documented product reason.

## 5. Components

### Primary Button

- **Structure**: `button` with mono label and optional Lucide icon.
- **Variants**: primary, secondary, destructive, disabled.
- **Spacing**: 4px vertical, 20px horizontal, minimum 36px height.
- **States**: default uses `--primary`; hover and active move to `--primary-strong`; focus uses a 1px ink outline plus offset.
- **Accessibility**: native button semantics, visible focus, disabled state uses `aria-disabled` or `disabled`.
- **Motion**: color change only, 120ms ease-out.

### Panel

- **Structure**: section or div with heading row, body rows, optional footer command row.
- **Variants**: primary canvas, soft inset, dark TUI.
- **Spacing**: 12px or 16px padding; 8px row rhythm.
- **States**: default, selected with strong hairline, error with danger border, empty with muted text.
- **Accessibility**: headings identify panel purpose; scroll regions are keyboard reachable.
- **Motion**: none by default.

### Command Row

- **Structure**: row with ASCII-style prefix, label, value, and trailing action.
- **Variants**: neutral, active, warning, danger, success.
- **Spacing**: 8px vertical, 12px horizontal.
- **States**: hover strengthens the hairline; active inverts or uses `--panel-3`.
- **Accessibility**: row buttons remain actual buttons or links.
- **Motion**: color and border changes only.

### Text Input

- **Structure**: input or textarea with optional label and helper text.
- **Variants**: single-line, textarea, search, command prompt.
- **Spacing**: 8px vertical, 12px horizontal, minimum 40px height.
- **States**: default soft fill, focus canvas fill with ink border, disabled panel-card fill, error danger border.
- **Accessibility**: explicit label or `aria-label`, helper/error text linked when present.
- **Motion**: focus border color changes in 120ms.

### TUI Output

- **Structure**: preformatted mono panel with prompt rows, status lines, and syntax tokens.
- **Variants**: runtime log, preview summary, code snippet, evidence excerpt.
- **Spacing**: 16px padding for dense logs, 64px only for hero-scale previews.
- **States**: streaming, complete, warning, error, empty.
- **Accessibility**: text remains selectable; live regions only for active status updates.
- **Motion**: no decorative typing effect; streaming updates are content changes.

## 6. Motion & Behavior

### Timing

| Type | Duration | Easing | Usage |
|------|----------|--------|-------|
| Micro | 100-150ms | ease-out | Button press, focus change |
| Standard | 160-220ms | ease-in-out | Panel reveal, tab switch |
| Emphasis | 240-320ms | cubic-bezier(0.16, 1, 0.3, 1) | Rare workflow transition |

### Rules

- Animate only `transform`, `opacity`, `color`, and `border-color`.
- Do not animate layout properties.
- Every interactive element has default, hover, active, focus-visible, and disabled states.
- Respect `prefers-reduced-motion` by removing non-essential transitions.

## 7. Depth & Surface

### Strategy

Depth strategy is borders-only plus tonal shift.

| Level | Value | Usage |
|-------|-------|-------|
| Flat | No border, no shadow | Page canvas and plain text rows |
| Hairline | `1px solid var(--line)` | Panels, dividers, controls |
| Strong hairline | `1px solid var(--line-strong)` | Selected or active edge |
| Inverted | `var(--surface-dark)` fill | Terminal/TUI output only |

### Rules

- No shadow declarations in the design system.
- No decorative color blends or orbs.
- Radius is `0px` for structural panels and `4px` maximum for controls.
- Dark surfaces are scarce and reserved for terminal output, not general decoration.
