# Data Visualization Colors

> Single source of truth for chart and visualization colors in HyperDX.
> Read this before adding, changing, or hard-coding a color in any chart,
> sparkline, heatmap, legend, status pill, or other data display.

## TL;DR

There are **three** color systems for data viz, with three different
consumption patterns:

| System                         | Use for                                  | Source of truth                          | How to consume                                |
| ------------------------------ | ---------------------------------------- | ---------------------------------------- | --------------------------------------------- |
| **Categorical 1–10**           | Multi-series line/bar/area/pie charts    | CSS vars `--color-chart-1`..`-10`        | `getColorProps(index, label)` in `utils.ts`   |
| **Semantic (success/warn/err)**| Status indicators, log levels, deltas    | CSS vars `--color-chart-{success,...}`   | `getChartColorSuccess/Warning/Error()`        |
| **Heatmap continuous**         | `DBHeatmapChart` density gradients       | `darkPalette`/`lightPalette` arrays      | Imported directly from `DBHeatmapChart.tsx`   |

**Hard rules**:

- **Never** pass a hex color to a chart series. Always go through one of the
  helpers above so theme switching works.
- **Never** map log levels to raw Mantine colors (`red.5`, `yellow.6`).
  Use `logLevelColor()` / `getColorProps()` — they pick the theme-correct
  semantic chart color.
- The categorical palette and the heatmap palette are **different things**.
  Don't reuse `--color-chart-N` for heatmap density; don't reuse the heatmap
  arrays for series colors.

## Where the colors live

### Categorical series palette (`--color-chart-1` through `--color-chart-10`)

| Theme       | File                                                                    | Index 1 (primary) |
| ----------- | ----------------------------------------------------------------------- | ----------------- |
| HyperDX     | `packages/app/src/theme/themes/hyperdx/_tokens.scss` (lines ~95–117)    | `#00c28a` brand green |
| ClickStack  | `packages/app/src/theme/themes/clickstack/_tokens.scss` (lines ~175–201)| `#437eef` Observable blue |

The same ten slots in both themes use the same hue families (blue, orange,
red, cyan, green, pink, purple, light blue, brown, gray) — only **slot 1**
differs:

- **HyperDX** leads with brand green, then Observable colors.
- **ClickStack** leads with Observable blue (Click UI accent yellow doesn't
  pass contrast on a typical chart background, so we don't use it as a series
  color — see "Per-theme considerations" below).

The vars are defined identically inside the dark and light selectors. That
duplication is intentional and called out in `_tokens.scss`: CSS specificity
requires it because the parent selectors `[data-mantine-color-scheme='dark']`
and `[data-mantine-color-scheme='light']` would otherwise drop the vars on
scheme switch.

### Semantic chart colors

```text
--color-chart-success            # success / OK / ingested / info-level fills
--color-chart-warning            # warnings, throttling, slowdowns
--color-chart-error              # failures, errors, alerts firing
--color-chart-success-highlight  # hover/selected variants (lighter shades)
--color-chart-warning-highlight
--color-chart-error-highlight
```

Defined in both `_tokens.scss` files. **HyperDX success uses brand green
(`#00c28a`)**; **ClickStack success uses Observable green (`#3ca951`)** so it
doesn't collide with the yellow brand accent. Warning and error are the same
across themes (orange `#efb118`, red `#ff725c`).

### JavaScript fallback (`packages/app/src/utils.ts`)

The CSS vars are the source of truth at runtime, but two palette objects in
`utils.ts` are the SSR fallback **and** the storybook reference:

```text
CHART_PALETTE              # HyperDX (green-first), lines ~356-374
CLICKSTACK_CHART_PALETTE   # ClickStack (blue-first), lines ~376-393
COLORS                     # Exported, ordered, HyperDX-default array, lines ~398-409
```

`COLORS[0]` corresponds to `--color-chart-1`, `COLORS[1]` to `--color-chart-2`,
and so on. **Keep them in sync.** If you change a hex in one place, change it
in all three (HyperDX SCSS, ClickStack SCSS, and `CHART_PALETTE` /
`CLICKSTACK_CHART_PALETTE` / `COLORS`).

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

- `getColorFromCSSVariable(index)` reads `--color-chart-{index+1}` from
  `documentElement` via `getComputedStyle`. On SSR or if the var is missing,
  it falls back to `COLORS[index % COLORS.length]`.
- `getSemanticChartColor(varName, hyperdxFallback, clickstackFallback)` does
  the same for the semantic vars and uses `detectActiveTheme()` (checks for
  the `theme-clickstack` class on `<html>`) to pick the correct fallback when
  CSS isn't available.
- During SSR, semantic readers return the **HyperDX** default — the
  hydration mismatch window is tiny because charts render after data fetch
  on the client.

### Heatmap palette (component-local)

`packages/app/src/components/DBHeatmapChart.tsx`:

- `darkPalette` (lines ~145–155): 7 stops, indigo → amber.
- `lightPalette` (lines ~156–164): 7 stops, medium blue → deep orange.
- Selected at the call site by `useMantineColorScheme()` and
  `colorScheme === 'light' ? lightPalette : darkPalette`.

These are **scheme-aware, not brand-aware**: HyperDX dark and ClickStack
dark share the same heatmap gradient, same for light. Red is intentionally
omitted from the high end so it can be reserved for error overlays.

`DBHeatmapChart.tsx` re-exports `darkPalette` and `lightPalette`.
`DBSearchHeatmapChart.tsx` imports them via that re-export — **do not**
duplicate the arrays in another component.

### Trace and delta-specific colors

A few component-local accents that are **not** part of the categorical or
semantic palettes:

- `ALL_SPANS_COLOR = 'var(--mantine-color-blue-6)'` in
  `packages/app/src/components/deltaChartUtils.ts` — the "all spans"
  reference bar in `DBDeltaChart`. Keep using this var; don't replace it
  with `--color-chart-1` (it's a comparison reference, not a series).
- Trace waterfall span tints in `DBTraceWaterfallChart.tsx` — derived from
  span attributes, not from this palette.

## Storybook reference

The visual reference for the categorical and semantic palettes is the
storybook story at:

```1:22:packages/app/src/theme/ChartColors.stories.tsx
import React from 'react';

import {
  COLORS,
  getChartColorError,
  getChartColorSuccess,
  getChartColorWarning,
} from '@/utils';

// Labels for chart colors - brand green first, then Observable palette
const COLOR_LABELS = [
  'Green (Brand)',
  'Blue',
  'Orange',
  'Red',
  'Cyan',
  'Pink',
  'Purple',
  'Light Blue',
  'Brown',
  'Gray',
];
```

It renders `AllChartColors`, `BarChartPreview`, `LineChartPreview`,
`SemanticColorsPreview`, and `AccessibilityCheck`. Run storybook in the
`app` package to inspect both schemes side by side.

## How to consume (recipes)

### Multi-series time-series chart

`ChartUtils.tsx → setLineColors` already wires the categorical palette per
series via `getColorProps(index, level)` in
`packages/app/src/ChartUtils.tsx`. **You should not have to think about
chart colors when adding a new chart that goes through `seriesToTimeSeries`
/ `setLineColors`** — they handle it.

If you're rendering a custom chart outside that pipeline:

```tsx
import { getColorProps } from '@/utils';

const series = data.map((s, i) => ({
  name: s.label,
  color: getColorProps(i, s.label),
  data: s.points,
}));
```

`level` (the second arg) is used to override with semantic colors when the
label looks like a log level (`'error'`, `'warn'`, `'info'`, etc.). Pass
`s.label` if it might encode a log level, otherwise pass an empty string.

### Status pill / delta indicator

```tsx
import { getChartColorError, getChartColorSuccess } from '@/utils';

<Box style={{ background: getChartColorError() }} />
<Box style={{ background: getChartColorSuccess() }} />
```

These functions return resolved hex strings, so they can be used in inline
styles or passed to libraries that don't understand CSS vars (e.g.
`uPlot`'s canvas fills).

If you're styling a DOM element with regular CSS, prefer the var directly:

```tsx
<Box style={{ background: 'var(--color-chart-success)' }} />
```

The var route reacts instantly to theme switches without re-running React.
Use the function form only when you need a string at compute time
(canvas/WebGL, library config objects, etc.).

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

The categorical palette is **ordered for distinguishability** — adjacent
slots are designed to contrast. If you're drawing a pie chart where the
largest slice should always be the most prominent color, sort your data
first and let the index map to the palette naturally:

```tsx
const sorted = data.toSorted((a, b) => b.value - a.value);
const slices = sorted.map((d, i) => ({
  ...d,
  color: getColorProps(i, d.label),
}));
```

`ChartUtils.tsx → buildPieChartData` already does this — the comment "Sort
in descending order so the largest slice is always first and gets the
first color in the palette" is at line ~444.

## Per-theme considerations

### HyperDX (green-first)

- Slot 1 is brand green (`#00c28a`) so single-series charts feel
  on-brand without any extra config.
- Semantic success **also** uses brand green, so success indicators and
  primary series share a hue. This is intentional but worth knowing:
  if a chart juxtaposes a "success" pill with a green series, that's
  expected, not a bug.

### ClickStack (blue-first)

- The brand accent is **yellow** (`--palette-brand-300: #faff69`). It is
  **not** in the chart palette and should not be added — yellow on a
  light background fails contrast, and yellow as a series color reads as
  "warning" in most contexts.
- Slot 1 falls back to Observable blue (`#437eef`).
- Semantic success is **Observable green** (`#3ca951`), distinct from
  the yellow brand accent. Don't try to "brand" success with yellow.

### Both themes

- The dark/light scheme split is handled by CSS (the same vars get
  redefined inside each scheme selector). React code does not need to
  branch on scheme except for the heatmap palette.
- The chart vars in `_tokens.scss` are intentionally duplicated across
  the dark and light blocks. If you change one, change the other.

## Adding new entries

### A new categorical slot (slot 11+)

Don't, unless you have a real need. Ten distinguishable hues is the upper
bound for readable categorical legends — beyond that, viewers can't tell
slices apart, and color-blind viewers definitely can't. Solutions in
descending order of preference:

1. **Group small categories** into "Other" before charting.
2. **Reuse slots** with patterns/strokes/labels for disambiguation.
3. If you really must extend: add the same `--color-chart-N` var to
   **all four** SCSS blocks (HyperDX dark, HyperDX light, ClickStack
   dark, ClickStack light), append the hex to `CHART_PALETTE` /
   `CLICKSTACK_CHART_PALETTE`, append to `COLORS`, append a label to
   `COLOR_LABELS` in `ChartColors.stories.tsx`.

### A new semantic color (e.g. `--color-chart-pending`)

1. Pick the hex per theme (HyperDX often uses brand variants;
   ClickStack uses Observable variants).
2. Add `--color-chart-pending` and (if needed)
   `--color-chart-pending-highlight` to **all four** SCSS blocks.
3. Add a hex to `CHART_PALETTE` and `CLICKSTACK_CHART_PALETTE`.
4. Add a `getChartColorPending()` reader in `utils.ts` that calls
   `getSemanticChartColor('--color-chart-pending', hyperdxHex, clickstackHex)`.
5. Update `ChartColors.stories.tsx` `SEMANTIC_CHART_COLORS` so the new
   color shows up in the design-tokens story.
6. If it should override based on a label / status string, extend
   `getLevelColor` / `logLevelColor` accordingly.

### A new heatmap palette

The current arrays were tuned to (a) be visible on the chart's dark/light
background, (b) avoid red at the high end so error overlays stay
readable, and (c) follow a perceptually monotonic luminance ramp.
Don't add a new palette without those three properties verified — both
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

- **Hex / keyword**: bypasses theme switching. ClickStack users will see
  HyperDX colors, dark/light won't react.
- **Raw Mantine**: bypasses semantic mapping. `green.5` is not the same
  as `--color-chart-success` once we tweak the brand palette.
- **Importing palette objects**: they're module-private. The exported
  surface is the reader functions and `COLORS` (the SSR fallback array,
  not for direct use in components).

## Pre-merge checklist for chart-touching PRs

- [ ] Toggled HyperDX ↔ ClickStack theme — series colors change as
      expected (slot 1 swaps green ↔ blue).
- [ ] Toggled dark ↔ light — categorical and semantic colors stay legible
      on both backgrounds; heatmap gradient flips palettes.
- [ ] Status indicators use `getChartColor*()` / `var(--color-chart-*)`,
      not raw Mantine colors.
- [ ] No new hex strings in chart components — all colors flow through
      `utils.ts` helpers or CSS vars.
- [ ] If you added or changed a hex, changed it in **all four** places
      (HyperDX SCSS, ClickStack SCSS, `CHART_PALETTE` /
      `CLICKSTACK_CHART_PALETTE`, `COLORS`).
- [ ] Storybook `Design Tokens / Chart Colors` still renders correctly.

## File reference summary

| What                                       | Where                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| HyperDX chart vars (dark + light)          | `packages/app/src/theme/themes/hyperdx/_tokens.scss`                        |
| ClickStack chart vars (dark + light)       | `packages/app/src/theme/themes/clickstack/_tokens.scss`                     |
| JS palettes + reader functions             | `packages/app/src/utils.ts`                                                 |
| Multi-series wiring (`setLineColors` etc.) | `packages/app/src/ChartUtils.tsx`                                           |
| Heatmap palettes                           | `packages/app/src/components/DBHeatmapChart.tsx` (`darkPalette`, `lightPalette`) |
| Storybook visual reference                 | `packages/app/src/theme/ChartColors.stories.tsx`                            |
| Delta "all spans" reference color          | `packages/app/src/components/deltaChartUtils.ts` (`ALL_SPANS_COLOR`)        |
