---
"@hyperdx/common-utils": minor
"@hyperdx/app": minor
---

refactor(theme): rename chart palette tokens from chart-1..10 to hue-named (chart-blue, chart-orange, ...) and unify the categorical palette across HyperDX and ClickStack

Stored configs from the initial color picker (#2265) keep working. `ChartPaletteTokenSchema` stays strict (a plain `z.enum`, so its `z.input` matches `z.output` — wrapping it in `z.preprocess` would poison `validateRequest`'s `req.body` inference all the way up to `Dashboard.tiles[i].config.color`). Migration of legacy `chart-1` .. `chart-10` happens in two complementary places: a fetch-time `normalizeDashboardTileColors` (in `packages/app/src/dashboard.ts`) heals the data once it lands in the client cache, and a new render-time `resolveChartPaletteToken` helper (in `common-utils/types.ts`, re-exported from `packages/app/src/utils.ts`) acts as belt-and-suspenders inside `DBNumberChart` and `ColorSwatchInput`. Both paths preserve the HyperDX slot ordering from #2265 (slot 1 = brand green, slot 2 = blue, etc.).

Brand identity for charts moves entirely into the semantic layer: HyperDX info logs and the `getChartColorInfo()` helper resolve to brand green via the new `--color-chart-info` token, while ClickStack info resolves to Observable blue. The categorical palette is now Observable 10, identical across themes — picking `chart-blue` always renders blue.
