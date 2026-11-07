---
name: Obsidian Slate
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#393939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353534'
  on-surface: '#e5e2e1'
  on-surface-variant: '#c7c4d5'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#918f9f'
  outline-variant: '#464553'
  surface-tint: '#c3c0ff'
  primary: '#c3c0ff'
  on-primary: '#221495'
  primary-container: '#6965db'
  on-primary-container: '#fefaff'
  inverse-primary: '#534ec3'
  secondary: '#ffb3ad'
  on-secondary: '#68000a'
  secondary-container: '#a40217'
  on-secondary-container: '#ffaea8'
  tertiary: '#ffb86d'
  on-tertiary: '#492900'
  tertiary-container: '#a86400'
  on-tertiary-container: '#fffaff'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e2dfff'
  primary-fixed-dim: '#c3c0ff'
  on-primary-fixed: '#0f0069'
  on-primary-fixed-variant: '#3a33ab'
  secondary-fixed: '#ffdad7'
  secondary-fixed-dim: '#ffb3ad'
  on-secondary-fixed: '#410004'
  on-secondary-fixed-variant: '#930013'
  tertiary-fixed: '#ffdcbd'
  tertiary-fixed-dim: '#ffb86d'
  on-tertiary-fixed: '#2c1600'
  on-tertiary-fixed-variant: '#683c00'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353534'
typography:
  headline-lg:
    fontFamily: Geist
    fontSize: 1.75rem
    fontWeight: '600'
    lineHeight: 2.25rem
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Geist
    fontSize: 1.375rem
    fontWeight: '600'
    lineHeight: 1.75rem
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Geist
    fontSize: 1.25rem
    fontWeight: '500'
    lineHeight: 1.625rem
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Geist
    fontSize: 1rem
    fontWeight: '500'
    lineHeight: 1.375rem
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Geist
    fontSize: 0.9375rem
    fontWeight: '400'
    lineHeight: 1.5rem
    letterSpacing: -0.005em
  body-md:
    fontFamily: Geist
    fontSize: 0.8125rem
    fontWeight: '400'
    lineHeight: 1.25rem
    letterSpacing: 0em
  body-sm:
    fontFamily: Geist
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: 1.125rem
    letterSpacing: 0.01em
  label-lg:
    fontFamily: JetBrains Mono
    fontSize: 0.8125rem
    fontWeight: '500'
    lineHeight: 1.125rem
    letterSpacing: 0.02em
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 0.6875rem
    fontWeight: '500'
    lineHeight: 1rem
    letterSpacing: 0.03em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 0.625rem
    fontWeight: '400'
    lineHeight: 0.875rem
    letterSpacing: 0.04em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 0.75rem
  margin: 1rem
  space-xs: 0.25rem
  space-sm: 0.375rem
  space-md: 0.5rem
  space-lg: 0.75rem
  space-xl: 1rem
---

## Brand & Style

This design system embodies an ultra-minimalist, distraction-free spatial workspace tailored for builders, systems architects, and technical visual thinkers. Inspired by the utility and lightweight ergonomics of lean canvas applications, the aesthetic prioritizes user-generated artifacts over user interface chrome.

The identity rests on raw technical restraint:
- **Style Archetype:** Precision Minimalist with technical tool-grade utility. Interface chrome steps back through uniform charcoal tones, letting the canvas breathe.
- **Atmosphere:** Deep focus, quiet confidence, non-intrusive utility. Elements feel weightless yet mathematically grounded.
- **Affordance Philosophy:** Toolbars and panels exist as floating spatial objects hovering over an infinite grid canvas. Interactive triggers employ subtle brightness shifts rather than heavy ornamental elevations.

## Colors

The palette relies on narrow tonal steps across near-black charcoal surfaces, accented by a distinct low-saturation signature purple for active tool states, and an alert red dedicated exclusively to live collaboration indicators.

### Palette Architecture
- **Canvas Base (`#121212`):** Ground zero of the viewport. Serves as the negative space for sketches and diagrams.
- **Surface Elevation 1 / Subtle Panel (`#1e1e1e`):** Context panels, inspectors, side drawers, and modal backdrops.
- **Surface Elevation 2 / Toolbar Surface (`#202020`):** Floating tool docks, tooltips, popovers, and elevated action bars.
- **Stroke / Structural Borders (`#2a2a2a`):** Ultra-subtle hairline dividers (1px) framing floating modules and canvas partitions.
- **Primary Text & Vector Contrast (`#e0e0e0`):** High-readability labels, active element names, and primary icons.
- **Muted Text & Inactive Icons (`#8e8e8e`):** Secondary meta-labels, keyboard shortcuts, grid indices, and default icons.
- **Primary Brand Accent (`#6965db`):** The signature canvas tool accent. Reserved for active tool selections, vector bounding nodes, focused outlines, and toggled switches.
- **Live Pulse Red (`#ef4444`):** Dedicated exclusively to real-time collaboration signals, live session indicators, and destructive confirms.

## Typography

Typography establishes an engineered, technical environment. The pairing unites **Geist** for frictionless reading and UI navigation with **JetBrains Mono** for numerical values, keyboard hotkeys, and coordinate metadata.

- **Geist:** Handles primary system typography. Its clean glyph geometries, neutral apertures, and tight tabular figures ensure zero visual interference with user diagrams.
- **JetBrains Mono:** Handles utility tokens, coordinates, tool hotkeys (`[V]`, `[R]`, `[T]`), export metrics, and canvas zoom percentages.
- **Scaling & Rendering:** All font sizes stay purposefully compact (peaking at 1.75rem on desktop) to optimize canvas real estate. Font smoothing is enforced (`-webkit-font-smoothing: antialiased`).

## Layout & Spacing

The canvas follows a spatial HUD (Heads-Up Display) layout model rather than traditional document column grids. Content resides across an infinite viewport, while operational interface panels float above it.

### Layout Model
- **Viewport Safe Region:** Margins of `1rem` (16px) suspend all fixed HUD objects (dock, layer list, properties bar, zoom control) away from window edges.
- **Central Floating Island:** The primary drawing toolbar is pinned horizontally center at `1rem` from the top or bottom viewport edge.
- **Inspector Panels:** Collapsible sidebar drawers dock flush or float at `1rem` offset with a fixed width of `240px` to preserve maximum working canvas.
- **Component Rhythm:** Spacing relies on a tight 4px/8px modular base scale. Toolbars use `0.25rem` (`space-xs`) internal gaps between tool buttons to optimize hit targets without wasting screen footprint.

### Responsive Behavior
- **Desktop (>= 1024px):** Floating islands with inline labels for complex tools; properties inspector docked to the top-left or right.
- **Tablet (768px - 1023px):** Compact toolbar pill centered; properties panel collapses into a floating bottom sheet or toggle drawer.
- **Mobile (< 768px):** Primary toolbar shifts to a bottom-anchored horizontal scrolling dock (`margin: 0.5rem`); secondary inspector controls surface through a bottom swipe-sheet.

## Elevation & Depth

Visual hierarchy uses flat layered tonal planes combined with crisp 1px strokes, avoiding skeuomorphic drop shadows. Depth mimics precision architectural sheets rather than physical surfaces.

### Surface Tiers
- **Tier 0 (Canvas):** `#121212` — Ground plane.
- **Tier 1 (Panels & Sheets):** `#1e1e1e` bordered with 1px `#2a2a2a`.
- **Tier 2 (Floating Pills & Docks):** `#202020` bordered with 1px `#2a2a2a`.
- **Tier 3 (Active Overlays & Tooltips):** `#202020` bordered with 1px `#6965db` (accentuated border indicates modal focus).

### Shadows
Shadows are minimal and purely functional:
- Floating islands and popovers: `0 4px 16px rgba(0, 0, 0, 0.45)`.
- Active focus halo: `0 0 0 1px #6965db`.
- No colored or multi-step diffused ambient shadows are used. Surfaces remain matte and light-absorbent.

## Shapes

The interface balances soft geometry with clean-edged tooling.

- **Floating Toolbars & Action Bars:** Form continuous rounded pill enclosures using `rounded-lg` (8px to 12px) to communicate self-contained, liftable objects.
- **Tool Buttons & Segment Controls:** Scaled at `0.5rem` (`roundedness: 2`) border-radius for balanced tactile targets within compact panels.
- **Canvas Nodes & Selection Bounds:** Crisp, square corner points (`roundedness: 0` or 1px) to emphasize technical drafting precision.
- **Inputs & Fields:** Fixed `0.375rem` - `0.5rem` border radius to match nested buttons.

## Components

### 1. Floating Tool Dock (Island)
- **Container:** Background `#202020`, border `1px solid #2a2a2a`, padding `space-xs`, border radius `0.75rem`.
- **Items:** Square icon-only buttons (`32x32px`), icon color `#8e8e8e`.
- **Hover State:** Background `#2a2a2a`, icon color `#e0e0e0`.
- **Active State:** Background `rgba(105, 101, 219, 0.15)`, icon color `#6965db`, stroke `1px solid rgba(105, 101, 219, 0.4)`.

### 2. Buttons
- **Primary:** Background `#6965db`, text `#ffffff`, typography `label-md`, padding `0.375rem 0.75rem`, border-radius `0.5rem`. Hover: `#5b57ce`.
- **Ghost / Tool Action:** Background `transparent`, text `#8e8e8e`, border none. Hover: background `#202020`, text `#e0e0e0`.
- **Destructive:** Background `transparent`, text `#ef4444`. Hover: background `rgba(239, 68, 68, 0.1)`.

### 3. Compact Floating Pills & Chips
- **Geometry:** Height `24px`, padding `0 0.5rem`, border-radius `9999px`.
- **Collaboration Live Pill:** Background `#202020`, border `1px solid #2a2a2a`, typography `label-sm`. Contains an active 6px indicator dot with `#ef4444` background and subtle CSS pulse animation.
- **Tool Hint Chip:** Monospace shortcut token (e.g., `1`, `H`, `V`) nested inside tooltips; background `#1e1e1e`, border `1px solid #2a2a2a`, color `#8e8e8e`.

### 4. Input Fields & Numeric Scrubber Inputs
- **Base:** Background `#121212`, border `1px solid #2a2a2a`, color `#e0e0e0`, font family `JetBrains Mono`, font size `0.75rem`, height `28px`, padding `0 0.5rem`.
- **Focus:** Border `1px solid #6965db`, outline none.
- **Labels:** Muted `#8e8e8e` inline prefix (e.g., `X:`, `Y:`, `W:`, `H:`, `∠`).

### 5. Checkboxes & Toggle Controls
- **Toggle Base:** Dimensions `16x16px`, background `#121212`, border `1px solid #2a2a2a`, border-radius `4px`.
- **Selected:** Background `#6965db`, border-color `#6965db`, check icon `#ffffff`.

### 6. Canvas Inspector Cards
- **Surfaces:** Floating contextual card anchored alongside active selections.
- **Structure:** Background `#1e1e1e`, border `1px solid #2a2a2a`, padding `space-md`, border-radius `0.5rem`.
- **Divider Lines:** 1px hairline horizontal rules in `#2a2a2a` with zero vertical margin overhead.

### 7. Zoom & Coordinates Overlay
- **Docked:** Bottom-right corner pill.
- **Style:** Compact height (`26px`), monospace font `JetBrains Mono`, text color `#8e8e8e`. Hovering over zoom percentage triggers an inline dropdown slider menu.