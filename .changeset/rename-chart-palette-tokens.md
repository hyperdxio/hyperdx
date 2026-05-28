---
"@hyperdx/common-utils": minor
"@hyperdx/app": minor
---

refactor(theme): rename chart palette tokens from chart-1..10 to hue-named (chart-blue, chart-orange, ...) and unify the categorical palette across HyperDX and ClickStack

Stored configs from the initial color picker (#2265) keep working two ways. `ChartPaletteTokenSchema` runs a Zod `preprocess` that transparently maps legacy `chart-1` .. `chart-10` to their hue-named equivalents at parse time. Render-time consumers (`DBNumberChart`, `ColorSwatchInput`) additionally call a new `resolveChartPaletteToken` helper so legacy tokens still resolve even when the surrounding payload bypasses the schema (e.g. `useDashboards` raw-casts the API response). Both paths preserve the HyperDX slot ordering (slot 1 = brand green, slot 2 = blue, etc.).

Brand identity for charts moves entirely into the semantic layer: HyperDX info logs and the `getChartColorInfo()` helper resolve to brand green via the new `--color-chart-info` token, while ClickStack info resolves to Observable blue. The categorical palette is now Observable 10, identical across themes — picking `chart-blue` always renders blue.
