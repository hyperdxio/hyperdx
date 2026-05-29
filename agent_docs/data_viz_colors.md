# Data Visualization Colors

> Single source of truth for chart and visualization colors in HyperDX. Read
> this before adding, changing, or hard-coding a color in any chart, sparkline,
> heatmap, legend, status pill, or other data display.

## TL;DR

There are **three** color systems for data viz, with three different consumption
patterns:

| System                               | Use for                               | Source of truth                                               | How to consume                                                                               |
| ------------------------------------ | ------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Categorical (10 hues)**            | Multi-series line/bar/area/pie charts | `CATEGORICAL_HEX_BY_TOKEN` in `utils.ts` (CSS vars mirror it) | `getColorProps(index, label)` (positional) / `getColorFromCSSToken('chart-{hue}')` (by name) |
| **Semantic (success/warn/err/info)** | Status indicators, log levels, deltas | CSS vars `--color-chart-{success,warning,error,info}`         | `getChartColor{Success,Warning,Error,Info}()`                                                |
| **Heatmap continuous**               | `DBHeatmapChart` density gradients    | `darkPalette`/`lightPalette` arrays                           | Imported directly from `DBHeatmapChart.tsx`                                                  |

**Hard rules**:

- **Never** pass a hex color to a chart series. Always go through one of the
  helpers above so theme switching works.
- **Never** map log levels to raw Mantine colors (`red.5`, `yellow.6`). Use
  `logLevelColor()` / `getColorProps()` — they pick the theme-correct semantic
  chart color.
- The categorical palette and the heatmap palette are **different things**.
  Don't reuse `--color-chart-{hue}` for heatmap density; don't reuse the heatmap
  arrays for series colors.

## Where the colors live

### Categorical palette (`--color-chart-{hue}`)

The categorical palette is **unified across themes** — based on Observable 10
([d3 schemeObservable10](https://observablehq.com/@d3/color-schemes)), with
`chart-blue` swapped to `#437eef` so it matches the brand link color
(`--click-global-color-text-link-default` for ClickStack, same hue for HyperDX
series). All other hues are straight from Observable 10. Identical on HyperDX
and ClickStack:

| Token              | Hex       |
| ------------------ | --------- |
| `chart-blue`       | `#437eef` |
| `chart-orange`     | `#efb118` |
| `chart-red`        | `#ff725c` |
| `chart-cyan`       | `#6cc5b0` |
| `chart-green`      | `#3ca951` |
| `chart-pink`       | `#ff8ab7` |
| `chart-purple`     | `#a463f2` |
| `chart-light-blue` | `#97bbf5` |
| `chart-brown`      | `#9c6b4e` |
| `chart-gray`       | `#9498a0` |

**Source of truth for categorical hues lives in JS.** The matching
`--color-chart-{hue}` CSS vars in both
`packages/app/src/theme/themes/hyperdx/_tokens.scss` and
`packages/app/src/theme/themes/clickstack/_tokens.scss` are a stylesheet-author
affordance only — `getColorFromCSSVariable` and `getColorFromCSSToken` skip
`getComputedStyle` for categorical tokens and return values straight from
`CATEGORICAL_HEX_BY_TOKEN` in `utils.ts`. The palette is the same on every theme
today, so a DOM round-trip per series buys nothing.

The CSS vars exist for:

- SCSS modules and inline `style={{ background: 'var(--color-chart-blue)' }}`
  consumers (no JS import needed).
- Devtools inspection while debugging chart styling.
- Forward-compat: if a future brand wants to override hues, switch
  `getColorFromCSSVariable`/`getColorFromCSSToken` back to reading the var and
  add per-brand entries to `CATEGORICAL_HEX_BY_TOKEN`.

The 10 categorical hues live in a single shared partial,
`packages/app/src/theme/themes/_chart-categorical-tokens.scss`, which both brand
themes `@use` and `@include` inside their per-theme `chart-tokens` mixin. Each
theme's `chart-tokens` mixin is then `@include`'d inside both
`[data-mantine-color-scheme]` selectors. Sass inlines the bodies at each call
site, so the emitted CSS has the same per-scheme specificity as a
hand-duplicated block would — but the source lives in **one place** for the
unified categorical layer (the shared partial) and one block per theme for the
per-brand semantic layer. **If you change a hex in the shared partial, change it
in `CATEGORICAL_HEX_BY_TOKEN` in `utils.ts` too — the SCSS and JS sources are
intentionally mirrored.**

Brand identity for charts is carried by the **semantic** tokens
(`--color-chart-success`, `-info`) and by non-chart UI chrome (Mantine accent,
sidebar gradient, Click UI globals), not by which hue happens to appear at
categorical slot 0.

### Semantic chart colors (`--color-chart-{success|warning|error|info}`)

```text
--color-chart-success            # success / OK / ingested fills
--color-chart-warning            # warnings, throttling, slowdowns
--color-chart-error              # failures, errors, alerts firing
--color-chart-info               # info-level logs, neutral "primary" series
--color-chart-success-highlight  # hover/selected variants (lighter shades)
--color-chart-warning-highlight
--color-chart-error-highlight
```

Defined in both `_tokens.scss` files. **Per-brand**: HyperDX uses brand green
(`#00c28a`) for `success` and Observable cyan (`#6cc5b0`, same hue as the
categorical `chart-cyan`) for `info`; ClickStack uses Observable green
(`#3ca951`) for `success` and brand blue (`#437eef`, same hue as the categorical
`chart-blue` and `--click-global-color-text-link-default`) for `info`. Both
brands' `info` reuses a categorical hue rather than a bespoke value, so
info-level series visually rhyme with the matching categorical slot. Warning
and error are the same across themes.

Unlike the categorical hues, **the semantic CSS vars are read at runtime** via
`getComputedStyle` (see `getSemanticChartColor` in `utils.ts`). That keeps
inline `var(--color-chart-warning)` consumers like `LogLevel.tsx` reacting to
theme switches without a React re-render, and it lets JS callers like
`getChartColorSuccess()` return the correct hex for the active theme.

### Single source of truth in TS (`packages/app/src/utils.ts`)

```text
CATEGORICAL_HEX_BY_TOKEN  # { 'chart-blue': '#437eef', ... } — file-private,
                          # authoritative for categorical hues
SEMANTIC_CHART_PALETTE    # { hyperdx: {...}, clickstack: {...} } — file-private,
                          # SSR/fallback for the semantic CSS vars
COLORS                    # ordered hex array, derived from CATEGORICAL_PALETTE_TOKENS
```

`COLORS[i]` equals `CATEGORICAL_HEX_BY_TOKEN[CATEGORICAL_PALETTE_TOKENS[i]]`.
`COLORS` is what `getColorFromCSSVariable(i)` returns — on both server and
client, since categorical hues no longer round-trip through the CSS var.

The hue-named `CHART_PALETTE_TOKENS`, `CATEGORICAL_PALETTE_TOKENS`, and
`SEMANTIC_PALETTE_TOKENS` constants live in `packages/common-utils/src/types.ts`
so the Zod schema can reference them (shared with the API).

### Reader functions (`packages/app/src/utils.ts`)

These are the only functions React code should call:

| Function                         | Returns                                                     |
| -------------------------------- | ----------------------------------------------------------- |
| `getColorProps(index, level)`    | Categorical color by index, with log-level override applied |
| `semanticKeyedColor(key, index)` | Same, but driven by `key` (e.g. series name)                |
| `getColorFromCSSToken(token)`    | Resolves any `ChartPaletteToken` (categorical or semantic)  |
| `getChartColorSuccess()`         | `var(--color-chart-success)` resolved to a hex string       |
| `getChartColorWarning()`         | `var(--color-chart-warning)` resolved                       |
| `getChartColorError()`           | `var(--color-chart-error)` resolved                         |
| `getChartColorInfo()`            | `var(--color-chart-info)` resolved (brand-primary for info) |
| `getChartColor*Highlight()`      | Hover/selected variants                                     |
| `logLevelColor(key)`             | Maps `'error' \| 'warn' \| 'info'` → semantic color         |
| `getLogLevelColorOrder()`        | Stable ordering for log-level series                        |

Internals worth knowing:

- `getColorFromCSSVariable(index)` returns `COLORS[index % 10]` directly — no
  DOM read. Categorical hues are unified across themes, so the JS palette is
  authoritative.
- `getColorFromCSSToken(token)` is split:
  - Categorical tokens (`chart-blue`, etc.) come straight from
    `CATEGORICAL_HEX_BY_TOKEN` — same shortcut, no `getComputedStyle`.
  - Semantic tokens (`chart-success`, `-warning`, `-error`) read
    `--color-{token}` from `documentElement` via `getComputedStyle` and fall
    back to the active theme's `SEMANTIC_CHART_PALETTE` entry when running
    server-side or when the DOM read fails.
- `getSemanticChartColor(varName, key)` is the shared helper that backs the
  `getChartColor{Success,Warning,Error,Info}()` readers. It uses
  `detectActiveTheme()` (checks for the `theme-clickstack` class on `<html>`) to
  pick the correct per-brand fallback.
- During SSR, semantic readers return the **HyperDX** default — the hydration
  mismatch window is tiny because charts render after data fetch on the client.

### Legacy `chart-1` … `chart-10` tokens

The number-tile color picker (#2265) initially shipped with numeric tokens
(`chart-1` … `chart-10`). Renamed here to hue-named tokens so stored configs and
the upcoming external API surface are self-documenting.

Existing stored configs keep working. The mapping:

```text
chart-1  -> chart-green       (was HyperDX brand green at slot 1)
chart-2  -> chart-blue        (was HyperDX slot 2)
chart-3  -> chart-orange
...
chart-10 -> chart-gray
```

It preserves the HyperDX slot ordering from #2265, so HyperDX users see no
visual change.

> **⚠️ ClickStack legacy color caveat.** Pre-rename ClickStack used a different
> slot ordering than HyperDX (`--color-chart-1` was brand blue `#437eef`, not
> brand green; `--color-chart-2` was orange, not blue; etc.). Because the
> migration map preserves HyperDX slot ordering, any ClickStack dashboard saved
> via #2265 will visually shift: stored `chart-1` flips from brand blue to
> Observable green, `chart-2` flips from orange to blue, and so on. We chose
> this trade-off deliberately over branching the legacy map by active theme:
> `LEGACY_CHART_PALETTE_TOKEN_MAP` lives in `common-utils` (shared with the
> API), and migration is one-shot persisted on next save — theme-branching would
> couple common-utils to browser DOM state and still produce wrong results for
> users whose active theme changed since the original pick. Affected users can
> manually re-pick the desired hue via the (now hue-labeled) color picker. Use
> `chart-info` semantic if you need the brand-primary appearance.

**`ChartPaletteTokenSchema` itself stays strict** (a plain `z.enum`). Wrapping
it in `z.preprocess` would force the schema's `z.input` type to `unknown`, which
poisons `validateRequest`'s `req.body` inference in the API package all the way
up to `Dashboard.tiles[i].config.color`. Strict input/output equality is more
important than a one-line runtime migration buried in the schema.

Migration happens at two complementary layers instead:

1. **Fetch-time _and_ write-time** — `normalizeDashboardTileColors` in
   `packages/app/src/dashboard.ts` walks every tile and rewrites any legacy
   `config.color` to its hue-named equivalent via `resolveChartPaletteToken`. It
   runs on every read (`useDashboards` / `fetchLocalDashboards`) and on every
   write (`useUpdateDashboard` / `useCreateDashboard`). The write-time pass is
   what lets JSON imports (`DBDashboardImportPage`), presets, and
   MCP-constructed payloads pass the strict server-side validator, and it
   converges the DB-side data on next save instead of leaving legacy tokens in
   storage forever.
2. **Render-time** — `DBNumberChart` and `ColorSwatchInput` also call
   `resolveChartPaletteToken` as belt-and-suspenders for tiles constructed in
   memory between fetch and save (e.g. `ChartEditor` form state, unit-test
   fixtures, hand-rolled `Tile` literals).

`LEGACY_CHART_PALETTE_TOKEN_MAP` and `resolveChartPaletteToken` live in
`packages/common-utils/src/types.ts` next to the enum.

### Heatmap palette (component-local)

`packages/app/src/components/DBHeatmapChart.tsx`:

- `darkPalette` (lines ~145–155): 7 stops, indigo → amber.
- `lightPalette` (lines ~156–164): 7 stops, medium blue → deep orange.
- Selected at the call site by `useMantineColorScheme()` and
  `colorScheme === 'light' ? lightPalette : darkPalette`.

These are **scheme-aware, not brand-aware**: HyperDX dark and ClickStack dark
share the same heatmap gradient, same for light. Red is intentionally omitted
from the high end so it can be reserved for error overlays.

`DBHeatmapChart.tsx` re-exports `darkPalette` and `lightPalette`.
`DBSearchHeatmapChart.tsx` imports them via that re-export — **do not**
duplicate the arrays in another component.

### Trace and delta-specific colors

A few component-local accents that are **not** part of the categorical or
semantic palettes:

- `ALL_SPANS_COLOR = 'var(--mantine-color-blue-6)'` in
  `packages/app/src/components/deltaChartUtils.ts` — the "all spans" reference
  bar in `DBDeltaChart`. Keep using this var; don't replace it with a
  categorical token (it's a comparison reference, not a series).
- Trace waterfall span tints in `DBTraceWaterfallChart.tsx` — derived from span
  attributes, not from this palette.

## Storybook reference

The visual reference for the categorical and semantic palettes is the storybook
story at `packages/app/src/theme/ChartColors.stories.tsx`. It renders
`AllChartColors`, `BarChartPreview`, `LineChartPreview`,
`SemanticColorsPreview` (includes info; responds to the Brand toolbar),
`InfoChartColorsByBrand` (HyperDX cyan vs ClickStack blue side by side), and
`AccessibilityCheck`. Run storybook in the `app` package to inspect both schemes
side by side.

The number-tile color picker (`ColorSwatchInput.stories.tsx`) renders the same
tokens through the user-facing picker UI.

## How to consume (recipes)

### Multi-series time-series chart

`ChartUtils.tsx → setLineColors` already wires the categorical palette per
series via `getColorProps(index, level)` in `packages/app/src/ChartUtils.tsx`.
**You should not have to think about chart colors when adding a new chart that
goes through `seriesToTimeSeries` / `setLineColors`** — they handle it.

If you're rendering a custom chart outside that pipeline:

```tsx
import { getColorProps } from '@/utils';

const series = data.map((s, i) => ({
  name: s.label,
  color: getColorProps(i, s.label),
  data: s.points,
}));
```

`level` (the second arg) is used to override with semantic colors when the label
looks like a log level (`'error'`, `'warn'`, `'info'`, etc.). Pass `s.label` if
it might encode a log level, otherwise pass an empty string.

### Identity color ("this thing is always blue")

For UI surfaces that should always render a specific hue regardless of
multi-series ordering:

```tsx
import { getColorFromCSSToken } from '@/utils';

<Text c={getColorFromCSSToken('chart-blue')}>Always blue</Text>;
```

Or directly in CSS:

```tsx
<Box style={{ background: 'var(--color-chart-blue)' }} />
```

### Status pill / delta indicator

```tsx
import { getChartColorError, getChartColorSuccess } from '@/utils';

<Box style={{ background: getChartColorError() }} />
<Box style={{ background: getChartColorSuccess() }} />
```

These functions return resolved hex strings, so they can be used in inline
styles or passed to libraries that don't understand CSS vars (e.g. `uPlot`'s
canvas fills).

If you're styling a DOM element with regular CSS, prefer the var directly:

```tsx
<Box style={{ background: 'var(--color-chart-success)' }} />
```

The var route reacts instantly to theme switches without re-running React. Use
the function form only when you need a string at compute time (canvas/WebGL,
library config objects, etc.).

### User-customizable chart color (number tile etc.)

`ColorSwatchInput` stores the choice as a `ChartPaletteToken`. Resolve to a hex
at paint time via `getColorFromCSSToken(token)`. Never store hex strings in
chart configs — tokens reflow correctly across themes and color modes.

### Heatmap

```tsx
import { useMantineColorScheme } from '@mantine/core';
import { darkPalette, lightPalette } from '@/components/DBHeatmapChart';

const { colorScheme } = useMantineColorScheme();
const palette = colorScheme === 'light' ? lightPalette : darkPalette;
```

That's the only correct way to consume the heatmap gradient. Never reconstruct
it.

### Pie / donut where slice order matters

The categorical palette is **ordered for distinguishability** — adjacent slots
are designed to contrast. If you're drawing a pie chart where the largest slice
should always be the most prominent color, sort your data first and let the
index map to the palette naturally:

```tsx
const sorted = data.toSorted((a, b) => b.value - a.value);
const slices = sorted.map((d, i) => ({
  ...d,
  color: getColorProps(i, d.label),
}));
```

`ChartUtils.tsx → buildPieChartData` already does this.

## Per-theme considerations

The categorical palette is identical on both themes — Observable 10. The only
place themes differ is the semantic chart layer.

### HyperDX

- `--color-chart-success` uses brand green (`#00c28a`).
- `--color-chart-info` uses Observable cyan (`#6cc5b0`, same as the categorical
  `chart-cyan`), so info-level logs and `getChartColorInfo()` render cyan —
  visually distinct from `success` (the two used to collapse to the same hex).
- Multi-series charts start at brand blue (slot 0, `#437eef`) and proceed
  through the canonical palette — brand identity is preserved via the Mantine
  green accent, sidebar gradient, and semantic chart tokens.

### ClickStack

- The brand accent is **yellow** (`--palette-brand-300: #faff69`). It is **not**
  in the chart palette and should not be added — yellow on a light background
  fails contrast, and yellow as a series color reads as "warning" in most
  contexts.
- `--color-chart-success` uses Observable green (`#3ca951`).
- `--color-chart-info` uses brand blue (`#437eef`, same as the categorical
  `chart-blue` and `--click-global-color-text-link-default`), so info-level logs
  and `getChartColorInfo()` render the brand blue.

### Both themes

- The dark/light scheme split is handled by CSS (the same vars get redefined
  inside each scheme selector). React code does not need to branch on scheme
  except for the heatmap palette.
- The chart vars in `_tokens.scss` are intentionally duplicated across the dark
  and light blocks. If you change one, change the other.

## Adding new entries

### A new categorical hue (11th token)

Don't, unless you have a real need. Ten distinguishable hues is the upper bound
for readable categorical legends — beyond that, viewers can't tell slices apart,
and color-blind viewers definitely can't. Solutions in descending order of
preference:

1. **Group small categories** into "Other" before charting.
2. **Reuse slots** with patterns/strokes/labels for disambiguation.
3. If you really must extend: add `--color-chart-{newhue}` to the shared
   `_chart-categorical-tokens.scss` partial — one edit covers both brands and
   both schemes via the existing `@include` chain. Then append
   `'chart-{newhue}'` to `CHART_PALETTE_TOKENS` in `common-utils/src/types.ts`,
   add the hex to `CATEGORICAL_HEX_BY_TOKEN` in `utils.ts`, and add a label
   entry in `ColorSwatchInput.tsx` → `TOKEN_LABELS` and
   `ChartColors.stories.tsx` → `COLOR_LABELS`.

### A new semantic color (e.g. `--color-chart-pending`)

1. Pick the hex per theme (HyperDX often uses brand variants; ClickStack uses
   Observable variants).
2. Add `--color-chart-pending` and (if needed) `--color-chart-pending-highlight`
   to the `@mixin chart-tokens` block in both theme files (HyperDX and
   ClickStack `_tokens.scss`). The mixin is `@include`'d in each scheme
   selector, so two edits cover dark and light for both brands.
3. Add `pending` (and optionally `pendingHighlight`) to
   `SEMANTIC_CHART_PALETTE.hyperdx` and `.clickstack` in `utils.ts`.
4. Append `'chart-pending'` to `CHART_PALETTE_TOKENS` (and
   `SEMANTIC_PALETTE_TOKENS` slice will pick it up automatically) in
   `common-utils/src/types.ts`.
5. Add a `getChartColorPending()` reader in `utils.ts` that calls
   `getSemanticChartColor('--color-chart-pending', 'pending')`.
6. Update `ChartColors.stories.tsx` `SEMANTIC_CHART_COLORS` so the new color
   shows up in the design-tokens story.
7. Add a `'chart-pending': 'Pending'` entry to `TOKEN_LABELS` in
   `ColorSwatchInput.tsx`.
8. If it should override based on a label / status string, extend
   `getLevelColor` / `logLevelColor` accordingly.

### A new heatmap palette

The current arrays were tuned to (a) be visible on the chart's dark/light
background, (b) avoid red at the high end so error overlays stay readable, and
(c) follow a perceptually monotonic luminance ramp. Don't add a new palette
without those three properties verified — both "physically dim" and
"perceptually noisy" gradients hurt readability.

If you do need to add one (e.g. for a different chart type), keep it
component-local like the existing ones, and re-use the same scheme-pick pattern
(`useMantineColorScheme` + ternary).

## Anti-patterns

```tsx
<Bar fill="#4269d0" />                          // hex string in a chart
<Line stroke="red" />                            // CSS color keyword
<Pill bg="green.5" />                            // raw Mantine palette for a status
<Bar fill={CATEGORICAL_HEX_BY_TOKEN['chart-blue']} />  // palette object is module-private
```

Why each is wrong:

- **Hex / keyword**: bypasses theme switching. Dark/light won't react, and any
  future per-theme tweak won't propagate.
- **Raw Mantine**: bypasses semantic mapping. `green.5` is not the same as
  `--color-chart-success` once we tweak the brand palette.
- **Importing palette objects**: `CATEGORICAL_HEX_BY_TOKEN` and
  `SEMANTIC_CHART_PALETTE` are module-private. The exported surface is the
  reader functions, the token enums, and `COLORS` (the SSR fallback array —
  prefer `getColorProps` / `getColorFromCSSToken` over indexing it directly).

## Pre-merge checklist for chart-touching PRs

- [ ] Toggled HyperDX ↔ ClickStack theme — semantic colors (success / info)
      change as expected; categorical palette stays identical.
- [ ] Toggled dark ↔ light — categorical and semantic colors stay legible on
      both backgrounds; heatmap gradient flips palettes.
- [ ] Status indicators use `getChartColor*()` / `var(--color-chart-*)`, not raw
      Mantine colors.
- [ ] No new hex strings in chart components — all colors flow through
      `utils.ts` helpers or CSS vars.
- [ ] If you added or changed a categorical hex, changed it in **both** places
      (`_chart-categorical-tokens.scss` shared partial,
      `CATEGORICAL_HEX_BY_TOKEN` in `utils.ts`).
- [ ] If you added or changed a semantic hex, changed it in **all three** places
      (the relevant theme's `chart-tokens` mixin in `_tokens.scss`,
      `SEMANTIC_CHART_PALETTE.{theme}` in `utils.ts`).
- [ ] Storybook `Design Tokens / Chart Colors` still renders correctly.

## File reference summary

| What                                                | Where                                                                            |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| Shared categorical chart vars (10 hues)             | `packages/app/src/theme/themes/_chart-categorical-tokens.scss`                   |
| HyperDX semantic chart vars + chart-tokens mixin    | `packages/app/src/theme/themes/hyperdx/_tokens.scss`                             |
| ClickStack semantic chart vars + chart-tokens mixin | `packages/app/src/theme/themes/clickstack/_tokens.scss`                          |
| JS palette objects + reader functions               | `packages/app/src/utils.ts`                                                      |
| Palette token enum + legacy migration               | `packages/common-utils/src/types.ts`                                             |
| Multi-series wiring (`setLineColors` etc.)          | `packages/app/src/ChartUtils.tsx`                                                |
| Number-tile color picker                            | `packages/app/src/components/ColorSwatchInput.tsx`                               |
| Heatmap palettes                                    | `packages/app/src/components/DBHeatmapChart.tsx` (`darkPalette`, `lightPalette`) |
| Storybook visual reference                          | `packages/app/src/theme/ChartColors.stories.tsx`                                 |
| Delta "all spans" reference color                   | `packages/app/src/components/deltaChartUtils.ts` (`ALL_SPANS_COLOR`)             |
