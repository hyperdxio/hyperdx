---
'@hyperdx/common-utils': minor
'@hyperdx/app': minor
---

refactor(theme): rename chart palette tokens from chart-1..10 to hue-named
(chart-blue, chart-orange, ...) and unify the categorical palette across HyperDX
and ClickStack

Stored configs from the initial color picker (#2265) keep working.
`ChartPaletteTokenSchema` stays strict (a plain `z.enum`, so its `z.input`
matches `z.output` — wrapping it in `z.preprocess` would poison
`validateRequest`'s `req.body` inference all the way up to
`Dashboard.tiles[i].config.color`). Migration of legacy `chart-1` .. `chart-10`
happens in two complementary places: a `normalizeDashboardTileColors` helper (in
`packages/app/src/dashboard.ts`) heals dashboards both on fetch (`useDashboards`
/ `fetchLocalDashboards`) and on write (`useUpdateDashboard` /
`useCreateDashboard`), so the DB-side data converges on next save and JSON
imports / preset constructions don't trip the strict server-side schema. A
render-time `resolveChartPaletteToken` helper (in `common-utils/types.ts`,
re-exported from `packages/app/src/utils.ts`) acts as belt-and-suspenders inside
`DBNumberChart` and `ColorSwatchInput` for tiles constructed in memory between
fetch and save. Both paths preserve the HyperDX slot ordering from #2265 (slot 1
= brand green, slot 2 = blue, etc.).

**ClickStack legacy color caveat:** Pre-rename ClickStack used a different slot
ordering than HyperDX (`--color-chart-1` was brand blue `#437eef`, not brand
green). The migration map uses HyperDX slot ordering, so any ClickStack
dashboard saved via #2265 with `color: 'chart-1'` will flip from blue to
Observable green after migration. We chose this trade-off deliberately over
branching the legacy map by active theme: `LEGACY_CHART_PALETTE_TOKEN_MAP` lives
in `common-utils` (shared with the API), and migration is one-shot persisted on
next save — theme-branching would couple common-utils to browser DOM state and
still produce wrong results for users whose active theme changed since the
original pick. Affected users can manually re-pick the desired hue via the (now
hue-labeled) color picker.

The categorical palette is based on Observable 10, with `chart-blue` swapped to
`#437eef` to match the brand link color
(`--click-global-color-text-link-default`); all other hues are straight from
Observable 10. The palette resolves identically on both themes — picking
`chart-blue` always renders the brand blue. Brand identity for charts moves
entirely into the semantic layer: `--color-chart-success` and `--color-chart-info`
resolve to categorical `chart-green` (`#3ca951`) and `chart-blue` (`#437eef`) on
both HyperDX and ClickStack, so success fills, info-level logs, and the
matching multi-series slots all read consistently across brands.

Internally, JS (`CATEGORICAL_HEX_BY_TOKEN` in `packages/app/src/utils.ts`) is
the source of truth for categorical hues — `getColorFromCSSVariable` and
`getColorFromCSSToken` skip `getComputedStyle` for categorical tokens since the
palette is unified across themes. The matching `--color-chart-{hue}` CSS vars in
`_tokens.scss` remain as a stylesheet-author affordance (inline `var()` use,
devtools inspection) and a hook for any future per-brand override. Semantic
tokens still resolve through `getComputedStyle` because they genuinely vary per
theme.
