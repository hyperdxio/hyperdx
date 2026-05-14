# Data Visualization Colors

> Single source of truth for chart and visualization colors in HyperDX.
> Read this before adding, changing, or hard-coding a color in any chart,
> sparkline, heatmap, legend, status pill, or other data display.

## TL;DR

There are **three** color systems for data viz, with three different
consumption patterns:

| System                         | Use for                                  | Source of truth                            | How to consume                                |
| ------------------------------ | ---------------------------------------- | ------------------------------------------ | --------------------------------------------- |
| **Categorical (10 named hues)**| Multi-series line/bar/area/pie charts    | CSS vars `--color-chart-{blue,orange,...}` | `getColorProps(index, label)` in `utils.ts`   |
| **Semantic (success/warn/err)**| Status indicators, log levels, deltas    | CSS vars `--color-chart-{success,...}`     | `getChartColorSuccess/Warning/Error()`        |
| **Heatmap continuous**         | `DBHeatmapChart` density gradients       | `darkPalette`/`lightPalette` arrays        | Imported directly from `DBHeatmapChart.tsx`   |

The categorical and semantic palettes are **identical across the HyperDX
and ClickStack themes** — they're defined once in
`packages/app/src/theme/themes/_chart-tokens.scss` and `@include`d by
both themes. Theme branding still differentiates UI chrome (Mantine
accent, Click UI globals); chart colors do not.

**Hard rules**:

- **Never** pass a hex color to a chart series. Always go through one of
  the helpers above so dark/light scheme switching works.
- **Never** map log levels to raw Mantine colors (`red.5`, `yellow.6`).
  Use `logLevelColor()` / `getColorProps()` — they pick the correct
  semantic chart color.
- The categorical palette and the heatmap palette are **different things**.
  Don't reuse `--color-chart-{name}` vars for heatmap density; don't reuse
  the heatmap arrays for series colors.

**Two ways to address the categorical palette**:

- **By name** (identity): `var(--color-chart-cyan)` always means cyan,
  regardless of where cyan sits in the categorical assignment order. Use
  this when a specific element should always be the same hue.
- **By position** (ordering): `getColorProps(index, label)` returns the
  `index`-th color from `CATEGORICAL_ORDER` in `utils.ts`. Use this for
  multi-series charts where each series just needs a distinct slot.

The two layers are decoupled: changing `CATEGORICAL_ORDER` to re-prioritize
which hue is "slot 0" doesn't move any of the named vars around.

## Where the colors live

### Categorical series palette (named slots)

Defined once in **`packages/app/src/theme/themes/_chart-tokens.scss`**
and consumed by both themes via `@include chart-tokens.chart-tokens`
inside their dark and light scheme blocks:

| CSS var                     | Hex       |
| --------------------------- | --------- |
| `--color-chart-blue`        | `#437eef` |
| `--color-chart-orange`      | `#efb118` |
| `--color-chart-red`         | `#ff725c` |
| `--color-chart-cyan`        | `#6cc5b0` |
| `--color-chart-green`       | `#3ca951` |
| `--color-chart-pink`        | `#ff8ab7` |
| `--color-chart-purple`      | `#a463f2` |
| `--color-chart-light-blue`  | `#97bbf5` |
| `--color-chart-brown`       | `#9c6b4e` |
| `--color-chart-gray`        | `#9498a0` |

Source: [Observable 10 categorical palette](https://observablehq.com/@d3/color-schemes).
Designed to be distinguishable on both dark and light backgrounds and
for color-vision-deficient viewers.

#### Ordering for multi-series charts

The categorical assignment order — which named slot is "slot 0", "slot 1",
etc. for multi-series charts — lives entirely in JS, in
`packages/app/src/utils.ts`:

```ts
const CATEGORICAL_ORDER = [
  'blue', 'orange', 'red', 'cyan', 'green',
  'pink', 'purple', 'lightBlue', 'brown', 'gray',
] as const;
```

`getColorProps(index, label)` walks this array. To re-prioritize the
default ordering for all charts, edit `CATEGORICAL_ORDER` — no SCSS edit
required. The named vars stay where they are.

#### Why one palette across both themes

Originally HyperDX led with brand green (`#00c28a`) and ClickStack led
with Observable blue. That coupled "brand identity" with "chart slot 1",
which in practice caused two problems:

- The HyperDX brand-green also doubled as `--color-chart-success`, so
  success pills and primary chart series shared a hue.
- Per-theme palette ordering required a runtime `detectActiveTheme()`
  branch in the JS fallback path and an SSR/hydration mismatch caveat.

Unifying on one palette removes both concerns. Brand identity stays in
the UI chrome (Mantine accent yellow vs green, sidebar gradient, etc.);
chart-color identity is now a stable, theme-agnostic contract.

#### Why scheme blocks still redeclare

Even though the values are identical between dark and light, both
scheme blocks `@include chart-tokens.chart-tokens` rather than declaring
the vars at a parent selector. The reason is CSS specificity: the rest
of the design tokens are scoped to
`[data-mantine-color-scheme='dark|light']` and would otherwise win the
cascade and reset the chart vars to `unset`. The shared partial keeps
the values in lockstep without sacrificing specificity.

### Semantic chart colors

```text
--color-chart-success            # success / OK / ingested / info-level fills
--color-chart-warning            # warnings, throttling, slowdowns
--color-chart-error              # failures, errors, alerts firing
--color-chart-success-highlight  # hover/selected variants (lighter shades)
--color-chart-warning-highlight
--color-chart-error-highlight
```

Also defined in `_chart-tokens.scss`. Identical across themes:

| Var                                | Hex       |
| ---------------------------------- | --------- |
| `--color-chart-success`            | `#3ca951` |
| `--color-chart-warning`            | `#efb118` |
| `--color-chart-error`              | `#ff725c` |
| `--color-chart-success-highlight`  | `#80d9b3` |
| `--color-chart-warning-highlight`  | `#f5c94d` |
| `--color-chart-error-highlight`    | `#ffa090` |

Note that `--color-chart-success` (`#3ca951`) is **not** the same var as
`--color-chart-green` (`#3ca951`) — they happen to coincide today but
they're two different vars with different intents. Treat them as
independent contracts: success can change to a less-saturated green
without touching the categorical palette, and vice versa.

### JavaScript palette (`packages/app/src/utils.ts`)

The CSS vars are the source of truth at runtime; `utils.ts` mirrors them
in three pieces:

```text
CHART_PALETTE        # name -> hex map, mirrors `_chart-tokens.scss`
CATEGORICAL_ORDER    # ordered list of palette keys for slot-N assignment
COLORS               # exported hex array, derived from CATEGORICAL_ORDER
```

`COLORS[i]` always equals `CHART_PALETTE[CATEGORICAL_ORDER[i]]`. It's
exported as the SSR fallback for `getColorFromCSSVariable(index)` and a
convenience for callers that want a positional hex without going through
the helpers. **Keep them in sync.** A hex change must update both
`_chart-tokens.scss` and `CHART_PALETTE`. Re-ordering the categorical
assignment is a `CATEGORICAL_ORDER`-only edit.

### Reader functions (`packages/app/src/utils.ts`)

These are the only functions React code should call:

| Function                         | Returns                                              |
| -------------------------------- | ---------------------------------------------------- |
| `getColorProps(index, level)`    | Categorical color, with log-level override applied   |
| `semanticKeyedColor(key, index)` | Same, but driven by `key` (e.g. series name)         |
| `getChartColorSuccess()`         | `var(--color-chart-success)` resolved to a hex string|
| `getChartColorWarning()`         | `var(--color-chart-warning)` resolved                |
| `getChartColorError()`           | `var(--color-chart-error)` resolved                  |
| `getChartColor*Highlight()`      | Hover/selected variants                              |
| `logLevelColor(key)`             | Maps `'error' \| 'warn' \| 'info'` → semantic color  |
| `getLogLevelColorOrder()`        | Stable ordering for log-level series                 |

Internals worth knowing:

- `getColorFromCSSVariable(index)` looks up the categorical slot name via
  `CATEGORICAL_ORDER[index % CATEGORICAL_ORDER.length]`, then reads the
  matching `--color-chart-{kebab-case name}` var from `documentElement`
  via `getComputedStyle`. On SSR or if the var is missing, it falls back
  to `CHART_PALETTE[name]`.
- `getSemanticChartColor(varName, fallback)` does the same for the
  semantic vars. Single-argument fallback — both themes resolve to the
  same hex now, so the SSR fallback always matches the live value.

### Heatmap palette (component-local)

`packages/app/src/components/DBHeatmapChart.tsx`:

- `darkPalette` (lines ~145–155): 7 stops, indigo → amber.
- `lightPalette` (lines ~156–164): 7 stops, medium blue → deep orange.
- Selected at the call site by `useMantineColorScheme()` and
  `colorScheme === 'light' ? lightPalette : darkPalette`.

These are **scheme-aware, not theme-aware**: HyperDX dark and ClickStack
dark share the same heatmap gradient, same for light. Red is intentionally
omitted from the high end so it can be reserved for error overlays.

`DBHeatmapChart.tsx` re-exports `darkPalette` and `lightPalette`.
`DBSearchHeatmapChart.tsx` imports them via that re-export — **do not**
duplicate the arrays in another component.

### Trace and delta-specific colors

A few component-local accents that are **not** part of the categorical
or semantic palettes:

- `ALL_SPANS_COLOR = 'var(--mantine-color-blue-6)'` in
  `packages/app/src/components/deltaChartUtils.ts` — the "all spans"
  reference bar in `DBDeltaChart`. Keep using this var; don't replace
  it with `--color-chart-blue` (it's a comparison reference, not a
  categorical series).
- Trace waterfall span tints in `DBTraceWaterfallChart.tsx` — derived
  from span attributes, not from this palette.

## Storybook reference

The visual reference for the categorical and semantic palettes is the
storybook story at `packages/app/src/theme/ChartColors.stories.tsx`. It
renders `AllChartColors`, `BarChartPreview`, `LineChartPreview`,
`SemanticColorsPreview`, and `AccessibilityCheck`. Both schemes look
identical across the two brand themes (since chart vars are shared);
toggle dark/light to verify legibility.

## How to consume (recipes)

### Multi-series time-series chart

`ChartUtils.tsx → setLineColors` already wires the categorical palette
per series via `getColorProps(index, level)` in
`packages/app/src/ChartUtils.tsx`. **You should not have to think about
chart colors when adding a new chart that goes through
`seriesToTimeSeries` / `setLineColors`** — they handle it.

If you're rendering a custom chart outside that pipeline:

```tsx
import { getColorProps } from '@/utils';

const series = data.map((s, i) => ({
  name: s.label,
  color: getColorProps(i, s.label),
  data: s.points,
}));
```

`level` (the second arg) is used to override with semantic colors when
the label looks like a log level (`'error'`, `'warn'`, `'info'`, etc.).
Pass `s.label` if it might encode a log level, otherwise pass an empty
string.

### Status pill / delta indicator

```tsx
import { getChartColorError, getChartColorSuccess } from '@/utils';

<Box style={{ background: getChartColorError() }} />
<Box style={{ background: getChartColorSuccess() }} />
```

These functions return resolved hex strings, so they can be used in
inline styles or passed to libraries that don't understand CSS vars
(e.g. `uPlot`'s canvas fills).

If you're styling a DOM element with regular CSS, prefer the var
directly:

```tsx
<Box style={{ background: 'var(--color-chart-success)' }} />
```

The var route reacts instantly to scheme switches without re-running
React. Use the function form only when you need a string at compute
time (canvas/WebGL, library config objects, etc.).

### Heatmap

```tsx
import { useMantineColorScheme } from '@mantine/core';
import { darkPalette, lightPalette } from '@/components/DBHeatmapChart';

const { colorScheme } = useMantineColorScheme();
const palette = colorScheme === 'light' ? lightPalette : darkPalette;
```

That's the only correct way to consume the heatmap gradient. Never
reconstruct it.

### Pie / donut where slice order matters

The categorical palette is **ordered for distinguishability** —
adjacent slots are designed to contrast. If you're drawing a pie chart
where the largest slice should always be the most prominent color, sort
your data first and let the index map to the palette naturally:

```tsx
const sorted = data.toSorted((a, b) => b.value - a.value);
const slices = sorted.map((d, i) => ({
  ...d,
  color: getColorProps(i, d.label),
}));
```

`ChartUtils.tsx → buildPieChartData` already does this — the comment
"Sort in descending order so the largest slice is always first and gets
the first color in the palette" is at line ~444.

## Per-theme considerations

The categorical and semantic chart palettes are **theme-agnostic** —
both HyperDX and ClickStack resolve every `--color-chart-*` var to the
same hex. Theme branding lives elsewhere:

- **Mantine accent**: `green` for HyperDX, `yellow` for ClickStack.
  Affects `<Button color="primary">`, focus rings, links, etc.
- **Click UI globals**: ClickStack defines a `--click-global-color-*`
  layer (yellow brand palette, slate neutrals); HyperDX uses Mantine's
  green palette directly.
- **Sidebar / chrome**: each theme styles its own surfaces, headers,
  and field backgrounds independently.

The yellow ClickStack accent is **deliberately not** in the chart
palette — yellow on a light background fails contrast, and yellow as a
series color reads as "warning" in most contexts. If a future Click UI
update wants brand yellow visible somewhere in charts, that goes in a
new semantic var (`--color-chart-brand`?), never as a categorical slot.

## Adding new entries

### A new categorical slot (an 11th hue)

Don't, unless you have a real need. Ten distinguishable hues is the
upper bound for readable categorical legends — beyond that, viewers
can't tell slices apart, and color-blind viewers definitely can't.
Solutions in descending order of preference:

1. **Group small categories** into "Other" before charting.
2. **Reuse slots** with patterns/strokes/labels for disambiguation.
3. If you really must extend:
   - Add the new `--color-chart-{name}` var to the
     `categorical-chart-tokens` mixin in `_chart-tokens.scss`.
   - Add the hex to `CHART_PALETTE` in `utils.ts` (camelCase key).
   - Append the new key to `CATEGORICAL_ORDER` in `utils.ts` to put it
     at the end of the assignment order, or insert it earlier to bump
     other hues down a slot.
   - Append a `{ key, cssSlug, label }` row to `CATEGORICAL_SLOTS` in
     `ChartColors.stories.tsx`.

### Reordering the categorical assignment (which hue is "slot 0"?)

Edit `CATEGORICAL_ORDER` in `utils.ts`. SCSS does not need to change —
the named vars stay where they are; only `getColorProps(index)`'s mapping
from index to hue moves.

### A new semantic color (e.g. `--color-chart-pending`)

1. Add `--color-chart-pending` and (if needed)
   `--color-chart-pending-highlight` to the `semantic-chart-tokens`
   mixin in `_chart-tokens.scss`.
2. Add the hex to `CHART_PALETTE` in `utils.ts` (do **not** add it to
   `CATEGORICAL_ORDER` — semantic vars are independent of the
   categorical assignment order).
3. Add a `getChartColorPending()` reader in `utils.ts` that calls
   `getSemanticChartColor('--color-chart-pending', CHART_PALETTE.<key>)`.
4. Update `ChartColors.stories.tsx` `SEMANTIC_CHART_COLORS` so the new
   color shows up in the design-tokens story.
5. If it should override based on a label / status string, extend
   `getLevelColor` / `logLevelColor` accordingly.

### A new heatmap palette

The current arrays were tuned to (a) be visible on the chart's dark/
light background, (b) avoid red at the high end so error overlays stay
readable, and (c) follow a perceptually monotonic luminance ramp. Don't
add a new palette without those three properties verified — both
"physically dim" and "perceptually noisy" gradients hurt readability.

If you do need to add one (e.g. for a different chart type), keep it
component-local like the existing ones, and re-use the same scheme-pick
pattern (`useMantineColorScheme` + ternary).

## Anti-patterns

```tsx
<Bar fill="#4269d0" />               // hex string in a chart
<Line stroke="red" />                // CSS color keyword
<Pill bg="green.5" />                // raw Mantine palette for a status

import { CHART_PALETTE } from '@/utils';   // CHART_PALETTE is not exported
```

Why each is wrong:

- **Hex / keyword**: bypasses the CSS var. Dark/light won't react, and
  any future palette tweak silently misses your chart.
- **Raw Mantine**: bypasses semantic mapping. `green.5` is not the same
  as `--color-chart-success` once we tweak the palette.
- **Importing palette objects**: `CHART_PALETTE` is module-private. The
  exported surface is the reader functions and `COLORS` (the SSR
  fallback array, not for direct use in components).

## Pre-merge checklist for chart-touching PRs

- [ ] Toggled dark ↔ light — categorical and semantic colors stay
      legible on both backgrounds; heatmap gradient flips palettes.
- [ ] Toggled HyperDX ↔ ClickStack — chart colors stay **the same**
      (only theme chrome should change).
- [ ] Status indicators use `getChartColor*()` / `var(--color-chart-*)`,
      not raw Mantine colors.
- [ ] No new hex strings in chart components — all colors flow through
      `utils.ts` helpers or CSS vars.
- [ ] If you added or changed a hex, changed it in **two** places
      (`_chart-tokens.scss` + `CHART_PALETTE` in `utils.ts`).
- [ ] If you added a new categorical slot, also added it to
      `CATEGORICAL_ORDER` in `utils.ts` and `CATEGORICAL_SLOTS` in
      `ChartColors.stories.tsx`.
- [ ] Storybook `Design Tokens / Chart Colors` still renders correctly.

## File reference summary

| What                                       | Where                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| Shared chart vars (categorical + semantic) | `packages/app/src/theme/themes/_chart-tokens.scss`                          |
| Theme files that include the partial       | `packages/app/src/theme/themes/{hyperdx,clickstack}/_tokens.scss`           |
| JS palette + reader functions              | `packages/app/src/utils.ts`                                                 |
| Multi-series wiring (`setLineColors` etc.) | `packages/app/src/ChartUtils.tsx`                                           |
| Heatmap palettes                           | `packages/app/src/components/DBHeatmapChart.tsx` (`darkPalette`, `lightPalette`) |
| Storybook visual reference                 | `packages/app/src/theme/ChartColors.stories.tsx`                            |
| Delta "all spans" reference color          | `packages/app/src/components/deltaChartUtils.ts` (`ALL_SPANS_COLOR`)        |
