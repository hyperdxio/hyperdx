---
'@hyperdx/common-utils': minor
'@hyperdx/app': minor
'@hyperdx/api': patch
---

refactor(theme): rename chart palette tokens from chart-1..10 to hue-named
(chart-blue, chart-orange, ...) and unify the categorical palette across HyperDX
and ClickStack

Stored configs from the initial color picker (#2265) keep working.
`ChartPaletteTokenSchema` stays strict (a plain `z.enum`, so its `z.input`
matches `z.output` — wrapping it in `z.preprocess` would poison
`validateRequest`'s `req.body` inference all the way up to
`Dashboard.tiles[i].config.color`). Migration of legacy `chart-1` .. `chart-10`
happens at five complementary points so no entry or wire-format path can slip
through, all composing over a single shared walker
(`walkRawDashboardTileColors` in `common-utils`) so the per-tile traversal
stays in lockstep:

- **Fetch-time / write-time (React)**: `normalizeDashboardTileColors` in
  `packages/app/src/dashboard.ts` heals dashboards on read
  (`useDashboards` / `fetchLocalDashboards` / `fetchDashboards`) and on write
  (`useUpdateDashboard` / `useCreateDashboard`). Unresolvable color strings
  (stale hexes, hand-edited values, forward-rolled future tokens) are
  preserved so the user's chosen value survives a render pass — the strict
  server-side schema surfaces a clear error on next save instead of the
  normalizer quietly dropping the field.
- **JSON import**: `DBDashboardImportPage` runs
  `normalizeRawDashboardTileColors` on the parsed JSON *before* the strict
  `DashboardTemplateSchema.safeParse`, so templates exported from a
  pre-rename deploy import cleanly.
- **Server-side GET response healing**: `getDashboards` / `getDashboard` in
  `packages/api/src/controllers/dashboard.ts` rewrite legacy tile colors on
  the way out. Pre-rename Mongo docs are served on the wire as
  hue-named tokens so non-React HTTP clients (CI scripts, stale bundle
  tabs during a rolling deploy, the external API) can round-trip
  GET → PATCH without ever resurrecting `chart-N` through the strict
  schema.
- **Server-side write shim**: the dashboards POST / PATCH routes mount
  a request-body preprocessor that rewrites legacy tile colors before
  `validateRequest` runs `ChartPaletteTokenSchema`. Catches non-React
  HTTP callers (stale-bundle tabs during a rolling deploy, CI scripts,
  MCP, the upcoming external-API parity work) for a one-release
  deprecation window without weakening the schema's input/output equality.
  The dashboard provisioner task applies the same shim before parsing
  on-disk template files.
- **Render-time (belt-and-suspenders)**: `DBNumberChart` and
  `ColorSwatchInput` also call `resolveChartPaletteToken` for tiles
  constructed in memory between fetch and save (`ChartEditor` form
  state, unit-test fixtures, hand-rolled `Tile` literals).

The migration preserves the HyperDX slot ordering from #2265 (slot 1 = brand
green, slot 2 = blue, etc.).

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
