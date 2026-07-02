# @hyperdx/app

## 2.29.0

### Minor Changes

- 9af8cbab: feat: add Browser RUM dashboard template

  - New "Browser RUM" template in the dashboards gallery for browser sessions instrumented with the HyperDX Browser SDK (or any OTel browser instrumentation emitting a `rum.sessionId` resource attribute)
  - Performance Overview section: page-view/session/error KPIs, Core Web Vitals (LCP/INP/CLS) p75, median/p75/p90 page-load percentiles, and long-task health
  - Page Views Breakdown section: traffic grouped by URL, browser (parsed from the `http.user_agent` the document-load instrumentation emits), country, and device size (derived from `screen.xy`)
  - Errors section with tabs for an overview, JS exceptions (by message and by page), and failing API calls
  - Five dashboard-level filters: Service, Environment, Service Version, Page URL, and Country
  - Top Countries tile and the Country filter populate when the OTel collector's `geoip` processor is enabled (geo can't be derived in the browser)

- 5cd709020: Add UI support for configuring an external Prometheus-compatible endpoint on a
  connection. Modify Connections model to now have a boolean
  `isPrometheusEndpoint` field and use host for storing the host.
- b6a4b3b3: feat: lazy-load dashboard tiles based on viewport visibility

  Dashboard tiles now only run their ClickHouse queries once they scroll into the browser viewport, instead of every tile querying on page load. A tile loads the first time it becomes visible and keeps its data afterward. This significantly reduces the number of queries fired when opening dashboards with many tiles.

- f40cf686b: feat(dashboards): add a background trend sparkline to number tiles

  Number tiles can now render a faint line or area sparkline behind the value,
  derived from a time-bucketed version of the same query, so the value's trend
  over the selected range is visible at a glance. This is handy for SLO /
  error-budget tiles where the burn over time matters as much as the current
  number. The sparkline inherits the tile's color by default and can be
  overridden to any palette token. Configure it under Display Settings >
  Background chart on a number tile. Available on builder number tiles (raw SQL
  number tiles return a single value with no time dimension to bucket).

- 17e1eb19d: feat: Add an "external link" row-click action for dashboard table tiles
- c1403a7a7: Number chart tiles now support a second series with the "As Ratio" toggle (`series[0] / series[1]`), matching line and bar charts. Combined with a `percent` number format, this renders a percentage (e.g. success/error rate) as a single big number with the trend sparkline behind it.
- e03971b0: refactor(theme): rename chart palette tokens from chart-1..10 to hue-named
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
    `normalizeRawDashboardTileColors` on the parsed JSON _before_ the strict
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

- 418567ff: feat: trace panel inline split detail

### Patch Changes

- 56c58663: fix(search-filters): prevent nested filter dropdowns from disappearing on reopen
- 998ea5d0: feat: Add option to fit time chart y-axis lower bound
- 0497ca5dd: Bump http-proxy-middleware to v4, replacing http-proxy with httpxy
- 20fabc65: feat: add a "Connect your AI assistant" section to Team Settings

  A new section on the Team Settings page (Integrations tab, above the API Keys
  card) lets a user install the HyperDX MCP server in Claude Code, Cursor,
  VS Code + Copilot, Codex CLI, or any MCP-compatible host without hand-rolling
  JSON. Per-host snippets carry the user's personal access key so the install
  works against the existing `/api/mcp` route without extra setup.

- 8e52cef4: feat(dashboard): auto-resize font in number tiles to fit container

  Number tiles now automatically scale their font size to fit the available
  width, preventing text overflow on narrow tiles and making better use of
  space on wide ones. Includes an error boundary so a single broken tile
  does not crash the entire dashboard.

- 5a1dde4d3: fix(search): wrap date column values in a type-matching parse/convert expression when building IN/NOT IN filters, so including/excluding a timestamp value no longer fails with "Cannot convert string ... to type DateTime64" or "Type mismatch in IN ... Expected: DateTime. Got: Decimal64". Date column types are now resolved from the query result set, so aliased (`TimestampTime AS time`) and computed (`toDate(TimestampTime)`) DateTime/Date columns are also wrapped correctly when added to filters.
- 31b87816: feat(chart-explorer): duplicate a series in the chart builder

  Add a Duplicate button to each series row in the chart builder that inserts a
  copy of that series directly below it, so building a near-identical variant
  (for example avg and p95 of the same column) no longer requires re-entering
  every field by hand. "Add Series" still creates a blank series. The copy
  starts with an empty alias so it does not collide with the original's alias in
  the generated SQL.

- 5e19a2b42: Show elapsed time and Generated SQL for search timeline view
- 65931e37: feat(search): make active filter pills editable in place

  Clicking an active filter pill under the search bar now opens a small menu to copy the value, flip the filter polarity (include vs exclude), or switch to a different value of the same field, without removing and re-adding the filter. The polarity is preserved when changing the value, and the one-click remove on each pill is unchanged. Range and not-applied pills keep their remove-only behavior.

- 7152d2b6: feat: Use optimistic updates for favorites
- 497d50b4: feat: Allow selecting the column or SQL expression used for event pattern grouping (with shareable URL state)
- ae39bc436: fix: Correct filter handling for filter keys with special characters
- bd31ea982: fix: handle boolean values in JSON viewer filter actions
- 052315b1: fix: improve contrast of excluded search filter pills

  Excluded ("!=") filter pills above the search results used a saturated red background with red text and a red remove button, which made them hard to read in the light theme. They now use a soft red tint with a readable accent, legible in both light and dark themes.

- 7b6db8d91: fix(app): format log detail Timestamp in local timezone

  The log detail JSON viewer rendered Timestamp and TimestampTime as raw UTC ISO strings while the results table used the shared FormatTime helper.

- bcec17635: fix: allow saving edits to markdown dashboard tiles that have a minimal config shape (no resolved source)
- 8261b461: fix: inline parametric aggregate function arguments instead of passing as query parameters
- bf6e1f29: feat(charts): the time-chart series limit is now configured per chart in the Display Settings drawer instead of as a workspace-wide team setting (the team "Time Chart Series Limit" setting is removed). It is disabled by default — charts fetch every series and no `__hdx_series_limit` CTE is emitted — and is cleared back to disabled by emptying the field. The control only appears for builder line/bar charts; the limit and its Generated SQL preview now come from the chart's own config. When a limit is set, chunked time-chart queries keep a consistent top-N series set: previously each time-window chunk ranked its own top-N, so charts could render more series than the limit and adjacent windows disagreed; the ranking is now pinned to the newest chunk window for every chunk so the union across chunks equals the limit.
- f9fab8ed6: fix: Prevent table content from overlapping table headers
- 973d1201b: fix: polish promql experience across the app
- 712ba11c: fix: Navigate to the dashboard listing page after deleting a dashboard
- 21307756: fix(row-panel): mergePath now emits string-key subscripts for Map columns,
  preventing a crash when expanding rows with numeric-looking attribute keys

  `mergePath` converted numeric path segments to 1-based array subscripts
  (`[N+1]`) regardless of whether the parent column was a Map or an Array.
  On a `Map(String, String)` column this produced SQL like `LogAttributes[2]`,
  which ClickHouse rejects with `Illegal types of arguments:
Map(String, String), UInt8 for function arrayElement`. The grid row
  "expand" view failed for any row whose attribute path included a
  numeric-looking key under a Map column.

  `mergePath` now accepts a `mapColumns` argument alongside `jsonColumns`.
  For Map-typed parents, sub-keys always render as string subscripts
  (`Map['1']`) regardless of whether the key looks numeric. The three
  callers (`useAutoCompleteOptions`, `DBRowJsonViewer` via the row panels,
  `DBSearchPageFilters`) now thread Map-column names from the source
  schema. A new `useMapColumns` hook mirrors `useJsonColumns`.

  Fixes HDX-4369.

- 2cecc9f4: Dashboard table tiles configured with a row-click action now show a trailing arrow-up-right icon at the right edge of each row, revealed on hover, with a small tooltip that names the destination. Actionable rows get a stronger background highlight on hover to reinforce interactivity before the user sees the arrow fade in. The icon click navigates to the same URL as a row click, with all the standard native browser behaviors (cmd-click new tab, middle-click new tab, right-click context menu).
- d985895fa: Fix: Resolved an issue with markdown tiles breaking dashboard imports.
- 750b8afe: feat(mcp): add denoise option to clickstack_search tool

  Add a `denoise` boolean parameter to the MCP `clickstack_search` tool that
  automatically filters out high-frequency repetitive event patterns from
  search results, mirroring the web app's "Denoise Results" feature.

  When enabled, the tool samples 10k random events, mines patterns using
  the Drain algorithm, identifies noisy patterns (>10% of sample), and
  filters them out of result rows. Returns filtered rows plus metadata
  listing removed patterns with estimated counts.

  Extracts shared denoise constants (`DENOISE_SAMPLE_SIZE`,
  `DENOISE_NOISE_THRESHOLD`) into `@hyperdx/common-utils` so the web app
  and MCP server use the same values.

- cd6a17daf: feat: auto-fill metric table dropdowns when creating a Metrics source

  The 5 metric-table dropdowns (Gauge, Histogram, Sum, Summary, Exponential
  Histogram) now auto-populate by matching table names in the selected database
  to their metric type via suffix patterns. Prefers `otel_metrics_` prefixed
  names, never overwrites user selections, and shows a green notification on
  successful autofill.

- 6747cf963: fix(dashboards): keep the auto-detected number format when applying display settings

  Opening Display Settings on a number tile that auto-detects its format from the
  datasource (for example p95 of a trace Duration column) and clicking Apply no
  longer rewrites the format to Number. The drawer now reflects the
  datasource-derived format, and Apply persists `numberFormat` only when the user
  explicitly changes it; otherwise it stays unset so render-time auto-detection
  keeps driving the format.

- a258fcfe8: fix(dashboards): match the number-tile background sparkline to the displayed value

  The big number on a number tile is a single aggregate (its query drops `groupBy`), but the background sparkline kept any `groupBy` the tile carried over from a prior Line display type. It then plotted only the first group's trend behind a value that aggregates every group. The sparkline now drops `groupBy` as well, so its trend reflects the same single series as the value it sits behind.

- 9d713999: fix(z-index): keep sticky header below drawers and drawers above the fullscreen tile modal

  Two related z-index regressions:

  - `PageHeader` was pinned at `z-index: 100`, but app drawers opt into a
    much lower stack via `ZIndexContext` (`contextZIndex + 10`, so a
    top-level drawer renders at `z-index: 10`). The sticky header therefore
    floated above the drawer overlay. The header now sits at `z-index: 2` so
    drawer overlays reliably cover the page chrome while the header still
    wins against normal scrolling content.
  - `FullscreenPanelModal` used Mantine's default modal z-index (`200`) and
    didn't propagate it through `ZIndexContext`. Clicking a row in a
    fullscreen search tile opened a `DBRowSidePanel` drawer at `z-index: 10`
    that was hidden behind the modal. The modal now follows the existing
    `contextZIndex + 10` pattern and wraps its children in a
    `ZIndexContext.Provider`, so child drawers stack on top of it.

- 538a1c4e: chore: migrate the custom Dashboard page to shared `PageLayout` / `PageHeader`. Breadcrumbs, the editable dashboard name, dashboard actions (Favorite, Tags, Menu), and the "Created by … Updated …" meta now live in a single page header, while the query toolbar (SQL/Lucene WHERE, time range, granularity, Live, refresh, edit filters, Run) is pinned to the top of the scroll container as a dedicated sticky row — the chrome above scrolls away and only the toolbar follows the user. The "Updated …" meta moves to the right side of the breadcrumbs row instead of sitting as a separate body line.

  `PageHeader` gains a `stickyRow` slot that any page can use to declare a single row that should be the only pinned element, with the rest of the header treated as scrolling chrome. Other pages are unaffected — a `PageHeader` without `stickyRow` keeps the existing fully-sticky behavior.

- 5e3e541bb: fix(search): keep select-alias filters working in Event Patterns

  Filtering on a column the source exposes only under an alias (for example a
  default select of `ServiceName as service`) failed in the Event Patterns view
  with `Unknown expression or table expression identifier 'service'`. The
  results table works because its own SELECT defines the alias, but Event
  Patterns rebuilds the SELECT and did not carry the alias definitions. The
  pattern query now receives the same alias `WITH` clauses already threaded into
  the results, histogram, and heatmap queries, so the filter resolves.

- e4922804: feat: add source field suggestions
- defbe1f9: Add Cmd/Ctrl+Enter support for running raw SQL chart queries from the SQL editor.
- 1a64796c1: Removing relative imports and using path aliases
- c74744a5: fix: fallback to body or implicit column expression when other empty
- d1d91d74: feat(service-map): server-side filtering, latency percentiles, throughput & focus

  The Service Map gains server-side filtering (Lucene/SQL `where` plus a
  service-name multi-select with inbound/outbound neighbor expansion), latency
  percentiles (p50/p95/p99) and request throughput (req/s) in node and edge
  tooltips, a "Focus" action to scope the map to a service and its immediate
  dependencies, and node sizing by total throughput (incoming + outgoing).
  Percentiles are computed server-side via a single GROUPING SETS query.

- b763ba64: fix: next-runtime-env runtime env var injection fixed for images
- 53e8bd17: fix: Fix height of source select RHS menu
- 5e8af09be: Transition the local development server from Webpack to Turbopack to
  significantly improve build performance and hot-reloading speed.
- 2a681456: feat(source-picker): chip + kebab menu UX
- f95687b0: Fix the database, table, and connection dropdowns being clipped inside the source setup modal. The dropdowns now render in a portal, so the full list is visible and scrollable when configuring or editing a source.
- 48e19e8b: Suggest existing section names in the source form's **Section** field. The field is now an autocomplete fed by the sections already in use, so a new source can reuse an existing section instead of retyping it (which is how a section ends up split into near-duplicates like "Billing" and "billing"). The field stays free-text, so any new section name is still accepted.
- 03f9dd70: feat: add an optional Section field to data sources

  Sources can now carry an optional free-text Section label, set from the source
  settings form. The value is persisted and returned by GET /api/v2/sources, so
  external API consumers can read it. This lays the groundwork for grouping and
  searching sources by section in the source selector.

- fdb18f26: Group the data source selector by section and add tag-style search. When sources have a Section assigned, the selector lists them under section headers; search matches on both the source name and its section, so a section name acts as a tag (typing "billing" returns every source in the Billing section, including ones whose name does not contain "billing"). The selector stays flat until at least one source has a section, so deployments that have not adopted sections see no change. The grouped dropdown is also widened and pinned to the picker's left edge so section headers and source names are not cramped.
- 34aa906f0: Show each source's **Section** on the Manage Sources list. A sectioned source now displays its section, with a folder icon, in the dimmed metadata row alongside its connection and table, so the list mirrors the grouped selector. Sources without a section are unchanged.
- 6e0880a75: feat: Add Known Columns List setting for distributed tables
- 81e524c2: feat(charts): cap group-by time charts to a top-N series limit to prevent browser memory exhaustion on high-cardinality group-bys. The cap defaults to 100 (the number of series rendered) and is configurable per team via a new "Time Chart Series Limit" setting; series beyond the cap remain available in the series selector.
- bc5cd0021: feat: emphasize the series nearest the cursor in multi-series time charts. The nearest line is thickened and the others fade back, and its tooltip row is bolded while the rest dim, so a value is easy to trace back to its line.
- a6e7dcde: chore: Make error states consistent across chart types
- 9bbf68079: fix: bug preventing deletion of nested subdocuments like metadataMVs
- Updated dependencies [9119de5f]
- Updated dependencies [1d44098e5]
- Updated dependencies [9f23b7e58]
- Updated dependencies [998ea5d0]
- Updated dependencies [0497ca5dd]
- Updated dependencies [ee907386]
- Updated dependencies [5c46215f8]
- Updated dependencies [45954c318]
- Updated dependencies [5cd709020]
- Updated dependencies [9a7e392a]
- Updated dependencies [5a1dde4d3]
- Updated dependencies [b798f91f]
- Updated dependencies [ae39bc436]
- Updated dependencies [cdd7ca07]
- Updated dependencies [d11991b0c]
- Updated dependencies [8261b461]
- Updated dependencies [bf6e1f29]
- Updated dependencies [973d1201b]
- Updated dependencies [677e3f71]
- Updated dependencies [89949b1b]
- Updated dependencies [747352f3]
- Updated dependencies [8164492f]
- Updated dependencies [a19ba549]
- Updated dependencies [7e7159a5]
- Updated dependencies [63469fe0e]
- Updated dependencies [f34a31fdc]
- Updated dependencies [f6bda8c5]
- Updated dependencies [f326ccf8]
- Updated dependencies [750b8afe]
- Updated dependencies [caba7c255]
- Updated dependencies [f113ea36]
- Updated dependencies [634101c33]
- Updated dependencies [ba626ef96]
- Updated dependencies [f40cf686b]
- Updated dependencies [f126d5b1]
- Updated dependencies [ebfc2e80a]
- Updated dependencies [bbc29859d]
- Updated dependencies [17e1eb19d]
- Updated dependencies [60a91e43]
- Updated dependencies [e03971b0]
- Updated dependencies [adac913d]
- Updated dependencies [1a64796c1]
- Updated dependencies [c74744a5]
- Updated dependencies [03f9dd70]
- Updated dependencies [6e0880a75]
- Updated dependencies [fc3ef2dc]
- Updated dependencies [81e524c2]
- Updated dependencies [da3caab43]
- Updated dependencies [55a255a0a]
- Updated dependencies [9bbf68079]
  - @hyperdx/api@2.29.0
  - @hyperdx/common-utils@0.21.0

## 2.28.0

### Minor Changes

- 3123db53: feat: experimental promql support
- 1df7583d: feat: emit Lucene conditions from sidebar/dashboard filters to enable KV items direct_read optimization on Map columns

  Legacy `type: 'sql'` filters in URLs are automatically migrated to Lucene
  on page load. The persisted `DashboardFilter.expression` in MongoDB is unchanged.

- cb6a74ce: fix(otel-collector): allow `CUSTOM_OTELCOL_CONFIG_FILE` to override the
  default `memory_limiter`, `batch` (and other pipeline processors)

  Pipeline `processors:` lists used to be defined in the OpAMP remote config
  sent by the API (`packages/api/src/opamp/controllers/opampController.ts`).
  That meant the remote config overwrote any pipeline `processors:` list a
  user supplied via `CUSTOM_OTELCOL_CONFIG_FILE`, making it impossible to
  substitute the default `memory_limiter` with one configured for
  `limit_percentage`/`spike_limit_percentage` mode (#2145).

  The pipeline `processors:` lists now live in the bootstrap config
  (`docker/otel-collector/config.yaml` for supervisor mode, and
  `docker/otel-collector/config.standalone.yaml` for standalone mode). The
  OpAMP remote config no longer sets `processors:` on these pipelines, so the
  bootstrap+custom merge wins. Receivers and exporters are still configured
  dynamically by the OpAMP controller.

  To override `memory_limiter`, define a new processor with a different name
  in `CUSTOM_OTELCOL_CONFIG_FILE` and swap the pipeline `processors:` lists:

  ```yaml
  processors:
    memory_limiter/custom:
      check_interval: 5s
      limit_percentage: 75
      spike_limit_percentage: 25

  service:
    pipelines:
      traces:
        processors: [memory_limiter/custom, batch]
      metrics:
        processors: [memory_limiter/custom, batch]
      logs/out-default:
        processors: [memory_limiter/custom, transform, batch]
      logs/out-rrweb:
        processors: [memory_limiter/custom, batch]
  ```

  The default `memory_limiter` block defined in the base config is left in
  the merged config but is no longer referenced by any pipeline; the
  collector only instantiates `memory_limiter/custom` at runtime.

  The same swap pattern works for the `batch` processor (and any other base
  processor). For example, to lower the export timeout on a specific
  pipeline:

  ```yaml
  processors:
    batch/lowlatency:
      send_batch_size: 1000
      send_batch_max_size: 2000
      timeout: 500ms

  service:
    pipelines:
      traces:
        processors: [memory_limiter, batch/lowlatency]
      logs/out-default:
        processors: [memory_limiter, transform, batch/lowlatency]
  ```

  Lighter-weight env-var tuning is also available for the default `batch`
  processor without writing a custom config file:
  `HYPERDX_OTEL_BATCH_SEND_BATCH_SIZE`,
  `HYPERDX_OTEL_BATCH_SEND_BATCH_MAX_SIZE`, and `HYPERDX_OTEL_BATCH_TIMEOUT`.
  See the README for details.

- b8f51ed9: feat: upgrade to clickhouse-server 26.5

### Patch Changes

- 55926e5c: fix: "Add to Filters" on a JSON-typed ClickHouse column no longer produces an
  unparseable Lucene query

  Previously, clicking "Add to Filters" on a field under a JSON column wrapped
  the field path with `toString(...)` before handing it off as a Lucene filter
  key. Lucene's grammar forbids parentheses inside field names, so the resulting
  condition like `toString(JSONColumn.\`foo\`):"…"`failed to parse with`Expected … but ":" found.`

  The handler now passes the clean dot-notation path (e.g. `JSONColumn.foo`)
  to the filter setter.

- 1648c22c: feat(dashboard): add Table of Contents right rail with bulk collapse/expand

  Adds a toggleable right-rail Table of Contents to the dashboard page, plus
  "Collapse all sections" and "Expand all sections" actions. All three live
  under a new "View" section in the dashboard's existing menu. TOC visibility
  is persisted per-user via localStorage; bulk collapse uses the same
  per-viewer URL state as single-section toggling, so it's shareable via link
  and does not change the dashboard's stored defaults. Clicking a TOC entry
  scrolls the section into view, auto-expanding it first if collapsed.

- 937e043a: fix: collapse duplicate map sub-key entries in the search filter sidebar (HDX-4340)

  A map sub-field stored in `filterState` under dot notation (e.g. `LogAttributes.time`,
  from a Lucene URL round-trip) and the same key returned by the facet query under
  bracket notation (e.g. `LogAttributes['time']`) no longer render as two separate
  accordion items. The merged entry keeps the bracket form so "Load more" stays
  valid, and the user's selection still resolves via a tolerant filterState lookup.

- dcab1cb6: feat: default the direct_read map column optimization on supported ClickHouse versions

  The full-text-search logs schema (`00002_otel_logs.sql`) now ships with
  `ResourceAttributeItems`, `ScopeAttributeItems`, and `LogAttributeItems`
  ALIAS columns plus their `text(tokenizer='array')` skip indexes. The
  traces schema (`00005_otel_traces.sql`) similarly gains
  `ResourceAttributeItems` and `SpanAttributeItems` ALIAS columns with
  matching items indexes. New installs and freshly migrated tables get
  the optimization automatically — no manual `ALTER TABLE` required.

  Note: the traces table previously used only `bloom_filter` skip indexes
  and worked on any ClickHouse version. The added `text(tokenizer='array')`
  items indexes raise the minimum ClickHouse version required to **create**
  the traces table to **>= 26.2**. Existing tables on older clusters are
  unaffected (`CREATE TABLE IF NOT EXISTS` is a no-op).

  At query time, the app gates the `Map['key'] = 'value'` →
  `has(<MapItems>, concat('key', '=', 'value'))` rewrite on the connected
  ClickHouse server version (`SELECT version()`, cached per connection).
  The gate only applies to **ALIAS** items columns, which are computed at
  query time and therefore depend on the server being able to perform a
  direct_read against the underlying Map's tuple storage. The direct_read
  feature was backported into multiple stable 26.x release lines, so the
  gate uses a per-branch minimum:

  - 26.2 line: >= 26.2.19.43
  - 26.3 line: >= 26.3.12.3
  - 26.4 line: >= 26.4.3.37
  - 26.5+ : always supported

  ALIAS items columns on servers below their branch's threshold continue
  to compile filters into the original Map-subscript form.

  **MATERIALIZED items columns are always used when available**, regardless
  of ClickHouse version. MATERIALIZED columns are physically stored on
  disk, so `has(items, ...)` reads them directly and works on any
  ClickHouse version that supports the text index itself. Operators who
  want the optimization on servers below the backport cutoffs can
  `ALTER TABLE` to materialize the items columns.

- 923b544b: feat: preserve compatible filters when switching sources
- b94b8eff: fix: persist column widths in search results table
- 996a1139: fix(row-panel): hide empty attribute sections and stop showing "[Empty]"
  when the source's body column isn't configured

  The row-expand side panel always rendered `Log/Span Attributes` and
  `Resource Attributes` accordion sections, even when both were empty. The
  body header fell back to a literal `[Empty]` paper in two visually
  identical cases that meant different things: the body column was
  configured but the value was empty, or the body column wasn't configured
  on the source at all.

  The two attribute accordions now mirror the existing `topLevelAttributes`
  pattern and only render when their content is non-empty. The body header
  takes a new `bodyConfigured` prop: when `false` (source has neither body
  nor implicit column expression configured), the body paper is suppressed
  entirely. When `true` and the content is empty, the placeholder reads
  "No body for this event." instead of `[Empty]`.

  `DBRowOverviewPanel` derives `bodyConfigured` from
  `getEventBody(source) !== undefined`, which already returns `undefined`
  when neither expression is set.

  Fixes HDX-4373.

- e1c4381b: fix: bare-text Lucene search now falls back from Implicit Column Expression to
  Body Expression on log sources

  Previously, a log source configured with `bodyExpression` set but
  `implicitColumnExpression` unset threw `Can not search bare text without an
implicit column set.` on every bare-token search, even though the row panel
  rendered correctly using the body column.

  Search now reuses the same one-way fallback that `getEventBody` already
  implements: when no Implicit Column Expression is set, bare-text search runs
  against the configured Body Expression. Trace sources are unchanged
  (`spanNameExpression` is not a body equivalent for trace search).

- 19cd7c91: fix: only use pk and row uniqueness to look up a row
- a44fa21b: Number tile: pick a static color from the palette in Display Settings. The color picker stores a palette token (not a hex value) so the choice reflows correctly across light, dark, and IDE themes.
- b5148c85: Dashboard table tiles configured with a row-click action now show a hover hint describing where the click will go (for example, `Search HyperDX Logs` or `Open dashboard "API Latency Drilldown"`). The cell wrapper is now a real link, so cmd-click and middle-click open the destination in a new tab, right-click shows the browser context menu with "Open in New Tab" and "Copy Link Address", and the destination URL appears in the browser status bar on hover. Keyboard users can Tab to a cell and press Enter to navigate, with a visible focus ring.
- 0e8a5b39: chore: use `PageHeader` `title` prop on Alerts, Dashboards, and Saved Searches list pages for consistency with the shared header API.
- 800081c5: chore: migrate the ClickHouse dashboard to shared `PageLayout` with breadcrumbs and a sticky header (connection selector, time range, refresh) instead of a duplicate page title.
- 41d67603: chore: migrate the Kubernetes dashboard to shared `PageLayout` with breadcrumbs and a sticky header (log + metric sources, time range, refresh) instead of a duplicate page title.
- 4d248bf4: chore: migrate Service Map to shared `PageLayout` with a sticky toolbar (source, sampling, time range) and no duplicate page title.
- 633eda61: refactor: Use new VirtualMultiSelect for dashboard filter inputs
- 8938b05e: fix: let "Load more" surface unselected values in exact filter mode
- 04a5a925: feat: Add source scoping to dashboard filters
- b24cb88c: fix(app): copy correct session URL on first Share Session click

  The Share Session button captured `window.location.href` at render time, which ran before `nuqs` flushed `sid`/`sfrom`/`sto` into the URL. The button now reads the URL at click time via the shared `copyTextToClipboard` util, so the first copy always contains the session params (no reload needed).

- 8810ff0f: feat: Add option for force-enabling/disabling text index support
- a8eb27dc: feat: filters reflect all values, not search aware; filters use metadata MVs if available
- Updated dependencies [3123db53]
- Updated dependencies [d1342121]
- Updated dependencies [dcab1cb6]
- Updated dependencies [a945fa07]
- Updated dependencies [1df7583d]
- Updated dependencies [cb6a74ce]
- Updated dependencies [6a5ac3e3]
- Updated dependencies [e1c4381b]
- Updated dependencies [b30dfe0a]
- Updated dependencies [dcb85826]
- Updated dependencies [c3a8aa55]
- Updated dependencies [a4b9fa85]
- Updated dependencies [07911fd2]
- Updated dependencies [b5148c85]
- Updated dependencies [04a5a925]
- Updated dependencies [8810ff0f]
- Updated dependencies [a8eb27dc]
  - @hyperdx/common-utils@0.20.0
  - @hyperdx/api@2.28.0

## 2.27.0

### Patch Changes

- Updated dependencies [f5ae0062]
- Updated dependencies [fbe5a9a2]
  - @hyperdx/api@2.27.0

## 2.26.0

### Patch Changes

- 3becf06e: feat: Minor dashboard improvements
- e2db2efe: Tune HyperDX theme tokens for sidenav active states, field backgrounds, borders, and hover grays; remove redundant color prop from chart assistant button
- b1004b73: Fall back when the browser Clipboard API is unavailable and show a clear error
  if copying still fails.
- 4e32e9c8: Fix `href interpolation failed` error when loading a dashboard page directly without query params by guarding the granularity URL sync until the router is ready.
- e268f6aa: Fix label color for red `Menu.Item` rows (for example Logout) by overriding `--menu-item-color` in global CSS. `Menu.extend` item styles do not apply when the menu dropdown is portaled outside the Menu root.
- d2b6dde0: fix: Persist heatmap drag-select rectangle on Event Deltas and Search heatmaps so the dashed selection stays visible after mouseup
- 6c55978b: feat(alerts): include tileId in Slack alert URLs
- 3feaa013: chore: Remove the 'saved searches and dashboards have moved' callout
- df208247: fix: Fix missing bar chart bar when there is only one bar
- Updated dependencies [4c2c3f37]
- Updated dependencies [84117a7a]
- Updated dependencies [51abe987]
- Updated dependencies [46fe675b]
- Updated dependencies [7386f14b]
- Updated dependencies [6c55978b]
- Updated dependencies [46c1459b]
- Updated dependencies [40336e9e]
  - @hyperdx/api@2.26.0
  - @hyperdx/common-utils@0.19.1

## 2.25.0

### Minor Changes

- eb16df44: Add ability to disable data sources with improved UX
- 143f7a79: feat: Add per-series number formats
- 7d7269a7: feat: introducing rollup and source support for full autocomplete
- 4cc5eb3f: Add support for increase aggFn on sum counter metrics and rewrite sum metric rate computation to fix correctness issues.
- d3a5a575: feat: add optional note field to alerts

  Adds a freeform note/reason field to alerts that supports markdown formatting,
  allowing on-call responders to document why an alert exists, threshold decision
  history, and links to runbooks.

  - New `note` field on the Alert model (optional, max 4096 chars, supports
    markdown)
  - Note textarea in both the saved-search alert modal and the dashboard tile
    alert editor
  - Notes displayed on the /alerts page in a collapsible section (hidden by
    default) with full markdown rendering
  - Alert tabs in the saved-search modal show a red bell firing indicator
    alongside the webhook channel icon, matching the AlertStatusIcon pattern
    used on dashboard tiles and the app nav
  - The Alerts button on the search page shows a red bell icon when at least one
    alert in the saved search is firing
  - External API v2 updated with `note` field in OpenAPI docs

- 5c6da48c: refactor(alerts/search): consolidate the saved-search → chart-config builder
  into a single shared helper, `buildSearchChartConfig`, in
  `@hyperdx/common-utils/core/searchChartConfig.ts`. The app search page, the
  alert preview chart, and the scheduled alert task's `SAVED_SEARCH` branch now
  all route through it, so `tableFilterExpression`, `implicitColumnExpression`,
  sample-weight expressions, SELECT precedence, and the `count()` default
  SELECT shape are applied identically by construction.

  Behavior fixes that fall out of consolidation:

  - The alert task and the alert preview now apply `source.tableFilterExpression`
    on Log sources, matching what the search page already did.
  - A latent bug in the search-page builder is fixed: a non-null `filters`
    array no longer silently drops the `tableFilterExpression` SQL filter via
    spread-overwrite.

- a50db927: fix(security): redact sensitive fields from internal webhook API responses

  The `GET /api/webhooks` endpoint now masks webhook URLs (`<origin>/****`) and
  redacts header and query parameter values (keys preserved, values replaced with
  `****`), preventing team members from retrieving secrets configured by others.

  The `PUT` handler merges redacted markers back to stored values so editing a
  webhook without re-entering secrets preserves the originals. Changing the URL
  while preserving masked secrets is rejected to prevent exfiltration.

  `GET /api/webhooks`, `POST /api/webhooks`, and `PUT /api/webhooks/:id`
  responses now return masked values for `url`, `headers`, and `queryParams`
  instead of plaintext secrets.

- ef571cc0: feat: heatmap charts in chart editor and dashboards

  - Heatmap is now a selectable display type in the chart editor tabs
  - Dashboard tiles render heatmaps via the shared `DBHeatmapChart` component
  - Heatmap source picker restricted to trace sources; value/count expressions auto-populate from the source's duration expression
  - Display Settings drawer (scale, value, count) shared across search Event Deltas, chart editor, and dashboards
  - Click a dashboard heatmap tile to open Event Deltas with source, where clause, filters, and time range preserved
  - Dynamic Y-axis sizing measures formatted tick labels so long labels (e.g. "1.67min") are not clipped

### Patch Changes

- a5294f8d: fix: prevent false "data source not set" error on markdown dashboard tiles
- 24699cde: fix: Infer singular quantileXXX() from MV quantilesXXXState()
- 4e9caeca: Support per-signal OTLP exporter endpoints for Hyperdx internal telemetry
- 32b38c33: fix: ClickStack switch checked-state color not applying theme tokens
- 29586e7b: Enable end-to-end PR testing on Vercel previews by inlining the Express API into the Next.js `/api/[...all]` serverless function (opt-in via `HDX_PREVIEW_INLINE_API=true`). Production deploys (Docker fullstack image, standalone Next output) are unchanged — they keep proxying `/api/*` to the separately-deployed API service.

  Also realigns `clickhouseProxy.ts` with the upstream EE implementation (modulo CHC and RBAC code paths): query params are now parsed from the request URL via `validateAndSanitizePath()` + `URL.searchParams` instead of `req.query`, which fixes a `Setting all is neither a builtin setting nor started with the prefix 'custom_'` regression on Vercel previews where Next.js's `[...all]` catch-all route polluted `req.query`. Adds path-injection hardening, POST-only enforcement, and exposes `X-ClickHouse-Mixed-Response` / `X-ClickHouse-Service-Unavailable` response headers for the browser ClickHouse client.

- 6811ea05: fix: numbers from filters bar was always showing 0 instead of the count
- 3af4e920: Standardize query param libraries
- c2a9f96f: feat: Add more dashboard onClick linking options
- a36c5b19: feat: Add filter templating to custom dashboard on-click
- 6dc5d01d: fix: Ensure search histogram count matches result table count
- 401dff5a: feat: Support import/export for dashboard onClicks
- 88b2b646: fix: use block_number/block_offset to uniquely identify log rows
- Updated dependencies [a5294f8d]
- Updated dependencies [eb16df44]
- Updated dependencies [24699cde]
- Updated dependencies [143f7a79]
- Updated dependencies [f6a1d021]
- Updated dependencies [aa1a8523]
- Updated dependencies [4d22d4ba]
- Updated dependencies [fecbfff7]
- Updated dependencies [022fe893]
- Updated dependencies [7d7269a7]
- Updated dependencies [4cc5eb3f]
- Updated dependencies [41395ca7]
- Updated dependencies [41395ca7]
- Updated dependencies [41395ca7]
- Updated dependencies [41395ca7]
- Updated dependencies [41eefec7]
- Updated dependencies [d3a5a575]
- Updated dependencies [5c6da48c]
- Updated dependencies [29586e7b]
- Updated dependencies [a50db927]
- Updated dependencies [ef571cc0]
- Updated dependencies [1c73d0c4]
- Updated dependencies [694e3c92]
- Updated dependencies [eb7fdb4b]
- Updated dependencies [c2a9f96f]
- Updated dependencies [a36c5b19]
- Updated dependencies [9d5f14f3]
- Updated dependencies [401dff5a]
- Updated dependencies [88b2b646]
  - @hyperdx/common-utils@0.19.0
  - @hyperdx/api@2.25.0

## 2.24.1

### Patch Changes

- b73f6fcc: fix: Prevent duplicate tile IDs in dashboard imports
- 4c23e10a: feat: Allow displaying group-by columns on LHS of table
- e2fc25da: feat: Add custom table onClick behavior
- 7665fbe1: refactor: Unify section/group into single Group with collapsible/bordered options
- Updated dependencies [b73f6fcc]
- Updated dependencies [4c23e10a]
- Updated dependencies [e2fc25da]
- Updated dependencies [7665fbe1]
  - @hyperdx/common-utils@0.18.1

## 2.24.0

### Minor Changes

- 5885d479: Introduces Shared Filters, enabling teams to pin and surface common filters across all members.
- 0bfec148: Upgrade Mantine from v7 to v9 and remove react-hook-form-mantine dependency

### Patch Changes

- 1fada918: feat: Support alerts on Raw SQL Number Charts
- c4a1311e: fix: Fix "Copy entire row as JSON" button crashing on rows with non-string values
- a5869f0e: Dedupe source validation issue toasts so repeated source refetches update a single notification instead of stacking duplicates.
- 7953c028: feat: Add between-type alert thresholds
- d3a61f9b: feat: Add additional alert threshold types
- 5149fabd: feat: Add Python Runtime Metrics dashboard template
- 085f3074: feat: Implement alerting for Raw SQL-based dashboard tiles
- 739fe140: fix: time selector always resets to 00:00
- 3c057720: feat: Show alert execution errors in the UI
- 6ff1ba60: feat: Add alert history + ack to alert editor
- 4ca1d472: Allow manually constructed /trace URLs to land in the existing search experience with the trace viewer opened from URL state. This keeps trace deep links user-friendly while reusing the search page for source selection, not-found handling, and trace inspection.
- Updated dependencies [418f70c5]
- Updated dependencies [1fada918]
- Updated dependencies [7953c028]
- Updated dependencies [d3a61f9b]
- Updated dependencies [5885d479]
- Updated dependencies [cc714f90]
- Updated dependencies [085f3074]
- Updated dependencies [3c057720]
- Updated dependencies [6ff1ba60]
  - @hyperdx/common-utils@0.18.0

## 2.23.2

### Patch Changes

- 0daa5299: feat: Generate stable source IDs in local mode

## 2.23.1

### Patch Changes

- 7d1a8e54: fix: Show sidebar favorites empty state when none are starred yet
- 800689ac: feat: Add reusable EmptyState component and adopt it across pages for consistent empty/no-data states
- 2570ff84: fix: Change K8s CPU chart format from percentage to number to support both old and new OTel collector metric names
- ad71dc2e: feat: Add keyboard shortcuts modal from the Help menu

  - New **Keyboard shortcuts** item opens a modal documenting app shortcuts (command palette ⌘/Ctrl+K, search focus, time picker, tables, traces, dashboards, and more).
  - Help menu items ordered by importance (documentation and setup before shortcuts and community).
  - Shortcuts modal uses a readable width, row dividers, and **or** vs **+** labels so alternative keys are not confused with key chords.

- 1bcca2cd: feat: Add alert icons to dashboard list page
- 52986a94: Fix bug when accessing session replay panel from search page
- ffc961c6: fix: Add error message and edit button when tile source is missing
- 3ffafced: feat: show error details in search event patterns
- 61db3e8b: refactor: Create TileAlertEditor component
- f8d2edde: feat: Show created/updated metadata for saved searches and dashboards
- Updated dependencies [24767c58]
  - @hyperdx/common-utils@0.17.1

## 2.23.0

### Minor Changes

- a15122b3: feat: new team setting for number of filters to fetch
- 20e47207: feat: Add input filter pills below search input to make filters usage more clear on seach page.
- 941d0450: feat: support sample-weighted aggregations for sampled trace data

### Patch Changes

- bfc93811: feat: Group Dashboards and Searches by Tag
- 859ced5c: feat: Chart Explorer now auto-executes the chart on load when a valid source is configured. Deeplinks render results without requiring a manual click.
- e6a0455a: fix: Properly enable line wrap behavior in JSON viewer by default
- 518bda7d: feat: Add dashboard template gallery
- 676e4f4b: fix: differentiate map indexing vs array indexing
- 9852e9b0: perf: Defer expensive hooks in collapsed filter groups and virtualize nested filter lists
- 5e5c6a94: fix: slider thumb and mark styling not applying theme tokens

  - Move slider thumb styling from classNames to inline styles to fix CSS specificity issue where Mantine defaults override theme tokens
  - Add !important to slider mark styles to ensure token-based colors apply
  - Fix vertical centering of 6px slider mark dots within the 8px track
  - Remove broken translateX/translateY nudge that misaligned marks

- 4e54d850: fix: show Map sub-fields in facet panel for non-LowCardinality value types
- 011a245f: fix: Fix error state and table overflows
- 53ba1e39: feat: Add favoriting for dashboards and saved searches
- b7581db8: feat: Add more chart display units
- 05a1b765: fix: optimize order by should factor in wider cases, including the
  default otel_traces
- 48a8d32b: fix: Fixed bug preventing clicking into rows with nullable date types (and other misc type) columns.
- a55b151e: fix: render clickhouse keywords properly in codemirror
- 9cfb7e9c: fix: move help menu from footer to main nav links
- 308da30b: feat: Add $\_\_sourceTable macro
- 2bb8ccdc: fix: Fix query error when searching nested JSON values
- df170d1e: fix: Show error on DBInfraPanel when correlated metric source is missing
- e5c7fdf9: feat: Add saved searches listing page
- 0cc1295d: fix: Add source schema preview to SQL Charts and Trace Panel
- 1b77eab9: fix: replace sidebar collapse icons to align with ClickHouse collapse patterns
- 853da16a: fix: Fix flaky E2E tests
- b4e1498e: fix: Fix minor bugs in chart editor
- bb24994f: feat: use 1 minute window for searches
- Updated dependencies [518bda7d]
- Updated dependencies [4e54d850]
- Updated dependencies [53ba1e39]
- Updated dependencies [b7581db8]
- Updated dependencies [48a8d32b]
- Updated dependencies [a15122b3]
- Updated dependencies [a55b151e]
- Updated dependencies [308da30b]
- Updated dependencies [e5c7fdf9]
- Updated dependencies [941d0450]
  - @hyperdx/common-utils@0.17.0

## 2.22.1

### Patch Changes

- 6c347a52: fix: ClickStack and HyperDX color token improvements

  - Fix link colors in ClickStack (blue in light mode, yellow in dark mode)
  - Override checkbox and radio button colors to use accent color with contrasting icons
  - Restyle slider marks as solid 6px dots with semantic color tokens
  - Add subtle Button variant to both themes

- a6a83d59: feat: Add collapsible filter sidebar toggle to search page
- 470b2c29: ci: Replace QEMU with native ARM64 runners for release builds
- cdc29d5a: fix: Fix query error on ClickHouse Query latency chart
- 8b629385: fix: Preserve default select when saving search
- 7ab7f6de: feat: allow collapsing child spans
- c9d1dda3: feat: Add column toggle button to filter panel in DBSearchPage
- 45755260: fix: Prevent duplicate demo sources in Play Environment source select
- 275dc941: feat: Add conditions to Dashboard filters; Support filter multi-select
- 1fb8e355: fix: Improve auto-complete behavior for aliases and maps
- 2207edbf: docs: Link to the SQL-based visualization docs
- dd313f77: fix: Fix intermittently-missing SQL autocomplete suggestions
- e21811cc: feat: Add dashboard listing page
- Updated dependencies [4f7dd9ef]
- Updated dependencies [275dc941]
- Updated dependencies [6936ef8e]
  - @hyperdx/common-utils@0.16.2

## 2.22.0

### Minor Changes

- a8216d7e: feat: allow scroll to zoom and panning to trace timeline viewer
- b5c371e9: Add careers page (/careers) with Greenhouse job listings filtered to HyperDX/ClickStack roles, GitHub commit activity feed, and a CTA in the AppNav sidebar for local mode

### Patch Changes

- 60d1bbaf: feat: always-on attribute distribution mode for Event Deltas
- 26759f79: feat: improved attribute sorting with entropy scoring and proportional comparison
- 3d15b3de: feat: Enhance data source select with context-aware icons and inline actions
- 134f1dca: fix: escape service filter values on Services page to handle quoted names safely
- 068f72c7: fix: Add zero state to service map if no trace source is defined
- 72d4642b: feat: Add `link` variant for Button and ActionIcon components
- 1381782b: feat: Support raw sql number charts and pie charts
- 2e30c0e0: feat: Improve chart editor validations
- 69cf33cb: feat: show inline span durations in trace timeline
- e1cf4bca: fix: Override --mantine-color-text with semantic --color-text token
- 74d92594: feat: Support fetching table metadata for Distributed tables
- 33edc7e5: feat: Improve auto-completion for SQLEditor\
- 1e0f8ec7: feat: enable horizontal scrolling on search results table for small screens
- e355995c: fix: pass sidebar filters to alert preview chart
- 1d83bebb: feat: Add support for dashboard filters on Raw SQL Charts
- ce850647: fix: change sources to discriminated union
- 359b5874: fix: add explicit api typing to all api routes and frontend hooks
- 9682eb4d: fix: Fix filter value saving
- 25a3291f: feat: Attach service version to all internal telemetry
- Updated dependencies [2fab76bf]
- Updated dependencies [e18f88c8]
- Updated dependencies [e09c8c0e]
- Updated dependencies [1381782b]
- Updated dependencies [74d92594]
- Updated dependencies [1d83bebb]
- Updated dependencies [ce850647]
- Updated dependencies [359b5874]
- Updated dependencies [243e3baa]
- Updated dependencies [4cee5d69]
  - @hyperdx/common-utils@0.16.1

## 2.21.0

### Minor Changes

- 902b8ebd: feat(alerts): add anchored alert scheduling with `scheduleStartAt` and `scheduleOffsetMinutes`

### Patch Changes

- 1bae972e: fix: allow any numeric value for alert thresholds
- fd9f290e: feat: Add query params, sorting, and placeholders to Raw-SQL tables
- f5828d1b: feat: field filtering and priority classification for Event Deltas
- 2491c2a6: fix: Prevent metric name validation on markdown chart
- dda0f9a4: feat: Add custom ORDER BY expression for Log and Trace sources
- 32f1189a: feat: Add RawSqlChartConfig types for SQL-based Table
- 2efb8fdc: feat: filter/exclude/copy actions on Event Deltas attribute values
- c5173ba2: fix: tile alerts with groupBy now correctly track and display group names
- 705dd1b7: fix: Allow implicit column lucene search on services dashboard
- f889c349: chore: separate timeline components to own modules, fix lint issues
- 1e6fcf1c: feat: Add raw sql line charts
- b4f05587: feat: localStorage for dashboards/saved searches in LOCAL mode
- bbb1f1f0: feat: chart UX polish & heatmap fixes
- 68ef3d6f: feat: deterministic sampling with adaptive sample size for Event Deltas
- d661c809: fix: Add better URL encoding for query params with special characters
- a13b60d0: feat: Support Raw SQL Chart Configs in Dashboard import/export
- Updated dependencies [1bae972e]
- Updated dependencies [fd9f290e]
- Updated dependencies [dda0f9a4]
- Updated dependencies [32f1189a]
- Updated dependencies [3bc5abbf]
- Updated dependencies [1e6fcf1c]
- Updated dependencies [902b8ebd]
- Updated dependencies [a13b60d0]
  - @hyperdx/common-utils@0.16.0

## 2.20.0

### Minor Changes

- cd2b7a76: fix: revert use_top_k_dynamic_filtering setting for issues with ORDER BY rand()
- 3e8cc729: feat: add alerts to number chart

### Patch Changes

- 8772f5e2: chore: update clickhouse versions for compose files
- a6edb0dd: fix: the banner for the clickhouse build can now be collapsed
- 5162acb4: fix: apply correct color-scheme for light and dark modes so scrollbars match the active theme
- 1eede5ed: fix: align event patterns table headers to the left
  fix: remove empty wrapper div on Event Deltas and Event Patterns tabs
  fix: add consistent padding to Results Table, Event Deltas, and Event Patterns tabs
- 3797e657: fix: guard formatNumber against non-numeric values
- 247896e4: fix: Prevent crash when only one metric name exists
- 578b1eea: fix: localmode stops prematurely fetching data
  fix: users do not have to keep defining sources during onboarding modal if they already have sources
- 875f78d4: fix: connections will automatically connect in clickstack build if default credentials test succeeds
- Updated dependencies [cd2b7a76]
- Updated dependencies [d760d2db]
- Updated dependencies [34c9afeb]
  - @hyperdx/common-utils@0.15.0

## 2.19.0

### Minor Changes

- 8326fc6e: feat: use optimization settings if available for use in CH

### Patch Changes

- e55b81bc: fix: Support light-mode in tagging dropdown menu
- 575779d2: Support JSON type in Surrounding Context
- b5bb69e3: fix: Improve Pie Chart implemententation
- Updated dependencies [8326fc6e]
  - @hyperdx/common-utils@0.14.0

## 2.18.0

### Minor Changes

- 051276fc: feat: pie chart now available for chart visualization
- e984e20e: feat: Theme-based branding in UI copy. Replace hardcoded "HyperDX" with the current theme display name so ClickStack deployments show "ClickStack" (e.g. "Welcome to ClickStack", page titles, error messages, help text). Adds `useBrandDisplayName()` hook in ThemeProvider.

### Patch Changes

- ec54757e: feat: Add confirm dialog when closing tile editor w/ changes
- 185d4e40: fix: Add option to display all events in search histogram bars
- fa2424da: fix: correct generated favicons for HyperDX and ClickStack
- 5988850a: fix: Prevent sampled events error when HAVING clause is specified
- 4f1da032: fix: clickstack build fixed when running same-site origin by omitting credentials from Authorization header for local mode fetch
- 38286f67: fix: searching json number property error
- Updated dependencies [051276fc]
- Updated dependencies [4f1da032]
- Updated dependencies [b676f268]
  - @hyperdx/common-utils@0.13.0

## 2.17.0

### Minor Changes

- 3171a517: feat: Add option to filter out properties with blank values in column view
- 5c895ff3: Allow overriding default connections

### Patch Changes

- 679b65d7: feat: added configuration to disable frontend otel exporter
- 30f4dfdc: chore: update ClickStack favicons to be distinct across all ClickHouse apps/sites
- 651bf99b: chore: deprecate Nextra and remove related code
- 69f0b487: design: Make service map drill-down links more obvious
- ce09b59b: feat: add static build generation
- a8aa94b0: feat: add filters to saved searches
- c3bc43ad: fix: Avoid using bodyExpression for trace sources
- 161cdcc8: fix: error trace event pattern should have red color
- Updated dependencies [a8aa94b0]
- Updated dependencies [c3bc43ad]
  - @hyperdx/common-utils@0.12.3

## 2.16.0

### Minor Changes

- 6241c388: feat: Add metrics attribute explorer in chart builder

### Patch Changes

- fa2b73ca: feat: Format byte numbers on ClickHouse page
- b6c34b13: fix: Handling non-monotonic sums
- 79356c4c: Set Button component default variant to "primary" for consistent styling across the app
- 42820f39: fix: Apply theme CSS class during SSR to prevent button styling mismatch

  Adds the theme class (e.g., `theme-hyperdx`) to the HTML element during server-side rendering in `_document.tsx`. This ensures CSS variables for button styling are correctly applied from the first render, preventing a hydration mismatch that caused primary buttons to display with Mantine's default styling instead of the custom theme styling when `NEXT_PUBLIC_THEME` was explicitly set.

- e11b3138: fix: add react-hooks-eslint-plugin and fix issues across app
- Updated dependencies [b6c34b13]
  - @hyperdx/common-utils@0.12.2

## 2.15.1

### Patch Changes

- 6cfa40a0: feat: Add support for querying nested/array columns with lucene
- 3c38272f: UI improvements for ClickStack/HyperDX:

  - Improve Sessions page empty state with enhanced Card and Stepper component for setup instructions
  - Apply consistent IBM Plex Mono font family to log tables, JSON viewer, and multi-series table charts

- Updated dependencies [6cfa40a0]
  - @hyperdx/common-utils@0.12.1

## 2.15.0

### Minor Changes

- f44923ba: feat: Add auto-detecting and creating OTel sources during onboarding

### Patch Changes

- 9f75fe2e: fix: Ensure Noisy Patterns message isn't clipped
- d89a2db2: fix: Fix side panel tab colors in ClickStack theme
- ea56d11f: chore: Change "None" aggregation label to "Custom" in charts.
- 7448508d: feat: Theme-aware UI improvements for ClickStack

  - **Chart colors**: Made chart color palette theme-aware - ClickStack uses blue as primary color, HyperDX uses green. Charts now correctly display blue bars for ClickStack theme.
  - **Semantic colors**: Updated semantic color functions (getChartColorSuccess, getChartColorWarning, getChartColorError) to be theme-aware, reading from CSS variables or falling back to theme-appropriate palettes.
  - **Info log colors**: Changed info-level logs to use primary chart color (blue for ClickStack, green for HyperDX) instead of success green.
  - **Button variants**: Made ResumeLiveTailButton variant conditional - uses 'secondary' for ClickStack theme, 'primary' for HyperDX theme.
  - **Nav styles**: Fixed collapsed navigation styles for proper alignment and spacing when nav is collapsed to 50px width.
  - **Icon stroke width**: Added custom stroke width (1.5) for Tabler icons in ClickStack theme only, providing a more refined appearance.

- Updated dependencies [f44923ba]
  - @hyperdx/common-utils@0.12.0

## 2.14.0

### Minor Changes

- 4c287b16: fix: Fix external dashboard endpoints
- 2f1a13cc: feat: Multi-theme system with HyperDX and ClickStack branding support

  ## Major Features

  ### Multi-Theme System

  - Add infrastructure for supporting multiple brand themes (HyperDX & ClickStack)
  - Theme switching available in dev/local mode via localStorage
  - Production deployments use `NEXT_PUBLIC_THEME` environment variable (deployment-configured)
  - Each theme provides its own logos, colors, favicons, and default fonts

  ### Dynamic Favicons

  - Implement theme-aware favicon system with SVG, PNG fallbacks, and Apple Touch Icon
  - Add hydration-safe `DynamicFavicon` component
  - Include XSS protection for theme-color meta tag validation

  ### Component Refactoring

  - Rename `Icon` → `Logomark` (icon/symbol only)
  - Rename `Logo` → `Wordmark` (icon + text branding)
  - Each theme provides its own `Logomark` and `Wordmark` components
  - Update all component imports across the codebase

  ### User Preferences Updates

  - Rename `theme` property to `colorMode` to clarify light/dark mode vs brand theme
  - Remove background overlay feature (backgroundEnabled, backgroundUrl, etc.)
  - Add automatic data migration from legacy `theme` → `colorMode` in localStorage
  - Ensure existing users don't lose their preferences during migration

  ### Performance & Type Safety

  - Optimize theme CSS class management (single class swap instead of iterating all themes)
  - Improve type safety in migration function using destructuring
  - Add type guards for runtime validation of localStorage data

- d07e30d5: Associates a logged in HyperDX user to the ClickHouse query recorded in the query log.

### Patch Changes

- 9101a993: fix: Update ConnectionForm button variant based on test connection state

  Changed the button variant in the ConnectionForm component to reflect the test connection state, using 'danger' for invalid states and 'secondary' for others. This improves user feedback during connection testing.

- f7d8b83f: Improve sidebar expand/collapse animation
- b8ab312a: chore: improve Team typing
- 08b922cd: debug: notify SourceForm error path when message is 'Required'
- 16df5024: fix: Fix tile hover state after closing edit modal
- 22f882d6: Do not trigger table search input on modals/drawers
- 7a5a5ef6: fix: Fix histogram disappearing and scrollbar issues on event patterns and search pages

  Fixes regression from PR #1598 by adding proper flex container constraints to prevent histogram from disappearing and scrollbar from cutting off 120px early.

- be4b784c: fix: Make JSON line hover visible in inline panel
- eea4fa48: fix: Prevent orphan alert when duplicating dashboard tiles
- 0dd58543: fix: Fix dashboard error when using filter on non-String column
- Updated dependencies [6aa3ac6f]
- Updated dependencies [b8ab312a]
  - @hyperdx/common-utils@0.11.1

## 2.13.0

### Minor Changes

- 94ddc7eb: Add fullscreen panel view for dashboard charts

  - Add YouTube-style fullscreen panel mode for dashboard charts
  - Add expand button to chart hover toolbar (positioned after copy button)
  - Implement 'f' keyboard shortcut to toggle fullscreen (works like YouTube)
  - Support ESC key to exit fullscreen
  - Works with all chart types: Line, Bar, Table, Number, Markdown, and Search
  - Improved modal rendering to prevent screen shake/glitching
  - Follows Mantine useHotkeys pattern for keyboard shortcuts

- 9f51920b: Add a search input that allows searching within the virtual elements on the log search page
- bc8c4eec: feat: allow applying session settings to queries

### Patch Changes

- 5b3ce9fc: refactor: Standardize Button/ActionIcon variants and add ESLint enforcement
- 1cf8cebb: feat: Support JSON Sessions
- 190c66b8: Add metric column name validation when saving dashboard tiles
- 9725a1fc: chore: Remove beta label from MVs
- ddc54e43: feat: Allow customizing zero-fill behavior
- 18222cd3: fix: Fix accuracy of ClickHouse inserts chart
- 66b1a48a: fix: Disable usePresetDashboardFilters request in local mode
- de680527: fix: Make pattern sampling query random
- 418828e8: Add better types for AI features, Fix bug that could cause page crash when generating graphs
- f39fcdac: fix: Refresh metadata after creating new connection in local mode
- 5b252211: fix: Respect date range URL params on Services dashboard
- ddc7dd04: various improvements to search result drawers and nesting logic
- 79398be7: chore: Standardize granularities
- 72d89989: Fix sessions subpanel not being closable, also fix loading indicator adding additional scrollbar to page
- db845604: fix: bypass aliasWith so that useRowWhere works correctly
- cf71a1cb: feat: Add text-brand semantic color tokens for theme flexibility
- acefcbed: fix: Fix K8s events query for JSON schema
- 3a2c33d3: feat: debounce highlighted attribute validation query
- 1d961409: fix: Set correct values when opening number format form
- 6752b3f8: fix: Filter DBTraceWaterfall events on timestamp expression
- 1ed1ebf3: feat(charts): switch to Observable categorical color palette for better accessibility and theme support
- 824a19a7: refactor(app-nav): reorganize AppNav component structure and improve maintainability
- 78423450: Add `variant` prop to table components for muted background styling in dashboard tiles
- f98fc519: perf: Query filter values from MVs
- b2089fa9: fix: Prevent dashboard error when metricName is defined for non-metric source
- 64998e0f: fix: Fix dashboard filters from Metric Tables
- cf3ebb4b: feat: Add disabled state support and Storybook stories for Button and ActionIcon components

  - Ensure all Button and ActionIcon variants use Mantine's default disabled styling for consistency
  - Add comprehensive Storybook stories including Playground, DisabledStates, and LoadingStates
  - Improve component documentation and testing capabilities

- ac3082a5: Validate column names for metrics before creating a chart
- 16036025: feat: Add HAVING filter to table charts
- bf553d68: Revert "fix: alias reference bug in processRowToWhereClause"
- 4a856173: feat: Add hasAllTokens for text index support
- 5ba7fe00: style: Rename sidenav background color tokens for clarity and update AppNav hover/focus states
- Updated dependencies [1cf8cebb]
- Updated dependencies [418828e8]
- Updated dependencies [79398be7]
- Updated dependencies [bc8c4eec]
- Updated dependencies [00854da8]
- Updated dependencies [f98fc519]
- Updated dependencies [f20fac30]
- Updated dependencies [4a856173]
  - @hyperdx/common-utils@0.11.0

## 2.12.0

### Minor Changes

- 8b5e80da: Add chart legend series filtering with click and shift-click selection
- 5dded38f: Refactor Sources components and add custom Mantine UI variants

  - Move SourceForm to Sources/ subfolder with reusable SourcesList component
  - Add primary, secondary, and danger button/action icon variants
  - Improve Storybook with font switching and component stories
  - Update ErrorBoundary styling with danger variant

### Patch Changes

- e9650e86: Fix hydration errors across a variety of pages
- ab7645de: feat: Add a minimum date to MV configuration
- 9f9629e4: fix: Increase span waterfall limit to 50 - 100k spans
- 99863885: fix: Fix missing dashboard edit icons on search tile
- 1a9362e7: Fix bug where loading saved search from another page might use default values instead
- 2c288b1e: Fix threshold on alerts not visible, fix sessions page overflow bug
- 8927f9e2: chore: bundle drain3 wasm deps
- 725dbc2f: feat: Align line/bar chart date ranges to chart granularity
- 1e6987e4: fix: Set better Chart Axis Bounds
- 158ccefa: refactor: Add ChartContainer component with toolbar
- 8213d69b: fix: Ensure displayed queries and MV indicators match queried configs
- ae12ca16: feat: Add MV granularities and infer config from SummingMergeTree
- 3b71fecb: fix: display "temporary dashboard" banner until dashboard is created
- 8172fba9: fix: Fix a couple of visual bugs in Chart titles
- 0c16a4b3: feat: Align date ranges to MV Granularity
- Updated dependencies [ab7645de]
- Updated dependencies [ebaebc14]
- Updated dependencies [725dbc2f]
- Updated dependencies [0c16a4b3]
  - @hyperdx/common-utils@0.10.2

## 2.11.0

### Minor Changes

- 39633f3a: feat: Add span event annotations to waterfall view

### Patch Changes

- 4889205a: fix: Prevent crashes on Services and ClickHouse dashboards
- 103c63cc: chore(eslint): enable @typescript-eslint/no-unsafe-type-assertion rule (warn)
- e78960f3: style: Fix style inconsistencies
- 11bd8e3d: Fix issue where select is not updating when loading saved searches
- 8584b4a4: fix: source form was not loading properly for all sources
- Updated dependencies [103c63cc]
- Updated dependencies [103c63cc]
  - @hyperdx/common-utils@0.10.1

## 2.10.0

### Minor Changes

- a5a04aa9: feat: Add materialized view support (Beta)

### Patch Changes

- 12cd6433: Improvements to Webhooks rendering (grouping, icons, etc)
- 99e7ce25: Reduce instrumentation trace events when search results shown
- 5062d80d: fix: Prevent dashboard infinite re-render
- d5181b6a: fix: Add SPAN*KIND* values to service map filters
- 21427340: Improve light mode contrast for DBRowTableIconButton by removing hardcoded gray color and text-muted-hover class
- 215b9bf7: Add prop to disable drilldown if not supported
- 6d4fc318: feat: parallelize DBSearchPage's histogram query
- 8241ffea: Make line wrapping in search page persistent
- 96f0539e: feat: Add silence alerts feature
- e0c23d4e: feat: flush chunk data as it arrives if in order
- 4ba37e55: Swap out bootstrap icons for tabler icons across app
- 80117ebf: Minor UI Improvements in Search Filters UI
- b564a369: fix: Ensure adequate SQL/Schema Preview modal height
- 50ba92ac: feat: Add custom filters to the services dashboard"
- dc846011: fix: show alert indicator for bar charts too
- b99052ad: fix: cityHash64 in sessions cast to string due to number precision issues in the browser
- 141b4969: fix: Correctly disable previous period query
- b58c52eb: fix: Fix bugs in the Services dashboard
- 19b710fb: fix: Update Request Error Rate config to use MVs
- 84d60a64: fix: Fix double value for isRootSpan facet
- 61cb9425: Performance Improvement to only run sample query when the table is visible
- ae4c8765: fix: error loading row data by multiple search panel in dashboard
- 776e3927: fix: Fix queries/minute calculation in Services Dashboard
- 6d4fc318: feat: add teamsetting for paralellizing queries when possible
- 69d9a418: feat: Filter on isRootSpan column if present
- 780279fd: feat: Save tile to dashboard from chart explorer
- 468eb924: Update some forms to work better with React 19
- Updated dependencies [ca693c0f]
- Updated dependencies [50ba92ac]
- Updated dependencies [a5a04aa9]
- Updated dependencies [b58c52eb]
  - @hyperdx/common-utils@0.10.0

## 2.9.0

### Minor Changes

- 52d27985: chore: Upgrade nextjs, react, and eslint + add react compiler
- 630592db: # Font Rendering Fix

  Migrate from Google Fonts CDN to Next.js self-hosted fonts for improved reliability and production deployment.

  ## Changes

  - Replaced Google Fonts imports with `next/font/google` for IBM Plex Mono, Roboto Mono, Inter, and Roboto
  - Font variables are applied server-side in `_document.tsx` and available globally via CSS class inheritance
  - Implemented dynamic font switching with CSS variables (`--app-font-family`) and Mantine theme integration
  - Font configuration centralized in `src/config/fonts.ts` with derived maps for CSS variables and Mantine compatibility
  - Added Roboto font option alongside existing fonts (IBM Plex Mono, Roboto Mono, Inter)
  - CSS variable always has a value (defaults to Inter) even when user preference is undefined
  - Removed old Google Fonts CDN links from `_document.tsx`
  - `!important` flag used only in CSS for external components (nextra sidebar), not in inline styles
  - Fonts are now available globally without external CDN dependency, fixing production deployment issues

  ## Benefits

  - ✅ Self-hosted fonts that work in production even when CDNs are blocked
  - ✅ Improved performance with automatic optimization
  - ✅ Works with Content Security Policy (CSP) headers
  - ✅ Mantine components and sidebar now properly inherit selected fonts
  - ✅ Font selection persists through user preferences
  - ✅ DRY font configuration with derived maps prevents duplication
  - ✅ Server-side font setup eliminates runtime performance overhead

### Patch Changes

- 586bcce7: feat: Add previous period comparisons to line chart
- 4503d394: improve markdown rendering after we removed bootrstrap reset styles
- c60e646e: Improve how filters are parsed on the search page
- 337be9a2: Add support for deeplinking to search page from most charts and tables
- 991bd7e6: fix: Round previous period offset to the second
- 562dd7ea: Fix minor UI issues and enhance styling across various components
- 087ff400: feat: Grouped filters for map/json types
- b7789ced: chore: deprecate unused go-parser service
- 4b1557d9: fix: Backport Services Dashboard fixes
- 237a2677: style: Fix missing AlertHistory colors
- 3f941058: fix issue with query timeout on the search page
- bacefac9: fix: Fix session page source change on submit
- 2f25ce6f: fix: laggy performance across app
- ff422206: fix: Fix Services Dashboard Database tab charts
- d7a5c43b: feat: add ability to change live tail refresh interval

  Adds a dropdown selector in the search page that allows users to configure the live tail refresh interval. Options include 1s, 2s, 4s (default), 10s, and 30s. The selected refresh frequency is persisted in the URL query parameter.

- 7c391dfb: fix: Disable useSessionId query when traceId input is undefined
- 36cf8665: fix: Don't clobber spans in trace waterfall when multiple spans have duplicate span ids
- 07392d23: feat: Add clickpy_link to clickpy trace source attributes
- f868c3ca: Add back selection ui on histogram
- 21146027: chore: remove deprecated SpanAttribute.http.scheme reference from serviceDashboard
- 70fe682b: Add clickable alert timeline chips
- 7cf4ba4d: Allow HyperDX's listen address to be overriden at runtime with the env var HYPERDX_APP_LISTEN_HOSTNAME. The default remains 0.0.0.0 .
- 3b2a8633: fix: sort on the client side in KubernetedDashboardPage
- 9da2d32f: feat: Improve filter search
- 770276a1: feat: Add waterfall span/error count summary, span tooltip status
- 59422a1a: feat: Add custom attributes for individual rows
- 7405d183: bump typescript version
- 815e6424: chore: treat missing react hook dependencies as errors
- 5b7d646f: fix: date/timepicker issue with dates in the future
- fce307c8: feat: Allow specifying persistent order by in chart table
- c8ec7fa9: fix: Hide table header when no columns are displayed
- 770276a1: feat: Add search to trace waterfall
- a9f10c5f: feat: Add highlighted attributes to overview panel
- 238c36fd: feat: Improve display of large sizes and volumes of highlighted attributes
- Updated dependencies [586bcce7]
- Updated dependencies [ea25cc5d]
- Updated dependencies [52d27985]
- Updated dependencies [b7789ced]
- Updated dependencies [ff422206]
- Updated dependencies [59422a1a]
- Updated dependencies [7405d183]
- Updated dependencies [770276a1]
  - @hyperdx/common-utils@0.9.0

## 2.8.0

### Minor Changes

- f612bf3c: feat: add support for alert auto-resolve
- 91e443f4: feat: Add service maps (beta)
- cfba5cb6: feat: Sort source dropdown alphabetically
- af6a8d0d: feat: Remove `bootstrap`, `react-bootstrap` and unused `react-bootstrap-range-slider`, adopt semantic tokens, and improve Mantine UI usage

### Patch Changes

- 99cb17c6: Add ability to edit and test webhook integrations
- 44a6a08a: Remove react-select for mantine
- 3fb5ef70: Small fix for html structure nesting issues
- 4d1eaf10: style: Fix filter color and alert icon alignment
- 78aff336: fix: Group alert histories by evaluation time
- 892e43f8: fix: Improve loading of kubernetes dashboard
- f612bf3c: feat: support incident.io integration
- f612bf3c: fix: handle group-by alert histories
- c4915d45: feat: Add custom trace-level attributes above trace waterfall
- c42a070a: fix: Fix session search behavior
- 1e39e134: Fix bug with generating search urls
- b90a0649: fix: Switch to 'all' after filters change on kubernetes dashboard page
- 8dee21c8: Improve event deltas (error states, complex values leverage ctes, etc.)
- 09f07e57: fix: Prevent incorrect dashboard side panel close
- 2faa15a0: Add title tag to app where missed (including catchall title)
- 63fcf145: fix: optimize query key for aliasMap to prevent jitter
- 2743d85b: Add ability to resize trace waterfall subpanel
- a7e150c8: feat: Improve Service Maps
- 7bb7a878: feat: Add filter for root spans
- 64b56730: feat: Format row counts (result counter and scanned row estimate) in search page
- 24bf2b41: bug fixes with relative time selection
- c5cb1d4b: fix: add json compatibility for infrastructure tab
- 44caf197: Zero-fill empty alert periods
- Updated dependencies [f612bf3c]
- Updated dependencies [f612bf3c]
- Updated dependencies [f612bf3c]
- Updated dependencies [c4915d45]
- Updated dependencies [6e628bcd]
  - @hyperdx/common-utils@0.8.0

## 2.7.1

### Patch Changes

- 93edb6f8: fix: memoize inputs to fix text input performance
- d5a38c3e: fix: Fix pattern sample query for sources with multi-column timestamp expressions
- 7b6ed70c: fix: Support custom Timestamp Columns in Surrounding Context panel
- 2162a690: feat: Optimize and fix filtering on toStartOfX primary key expressions
- 15331acb: feat: Auto-select correlated sources on k8s dashboard
- bb3539dd: improve drawer a11y
- 24b5477d: feat: allow specifying webhook request headers
- 3ee93ae9: feat: Show pinned filter values while filters are loading
- de0b4fc7: Adds "Relative Time" switch to TimePicker component (if relative time is supported by parent). When enabled, searches will work similar to Live Tail but be relative to the option selected.
- 757196f2: close modals when bluring (dates and search hints)
- ff86d400: feat: Implement query chunking for charts
- 21614b94: feat: Include displayed timestamp in default order by
- 808413f5: Ensure popovers inside the TimePicker component can be accessed
- ab7af41f: avoid hydration errors when app loads if nav is collapsed
- Updated dependencies [2162a690]
- Updated dependencies [8190ee8f]
  - @hyperdx/common-utils@0.7.2

## 2.7.0

### Minor Changes

- b806116d: feat: Add subpath configuration support

  This change allows the HyperDX frontend to be served from a subpath (e.g.,
  `/hyperdx`). It includes updated Next.js, NGINX, and Traefik configurations,
  along with documentation for the new setup.

- 730325a5: Improve SourceSchemaPreview button integration in SourceSelect and DBTableSelect components.
- dbf16827: feat: add refresh to existing preset dashboards
- eaff4929: Add toggle filters button, copy field, and per-row copy-to-clipboard for JSON data and modal URLs in RawLogTable
- 348a4044: migration: migrate to Pino for standardized and faster logging

### Patch Changes

- 13b191c8: feat: Allow selection of log and metric source on K8s dashboard
- 1ed32e43: fix issue where new lines are not persisted to url params correctly
- 35c42222: fix: Improve table key parsing
- b68a4c9b: Tweak getMapKeys to leverage one row limiting implementation
- 2d27fe27: fix: Support JSON keys in dashboard filters
- 1cda1485: Fixes scrolling in TimePicker
- 2dc0079b: feat: Sort dashboard filter options
- 5efa2ffa: feat: handle k8s metrics semantic convention updates
- 43e32aaf: fix: handle metrics semantic convention upgrade (feature gate)
- bd940f30: style: Improve dashboard filter modal UX
- 3332d5ea: Add ability to customize event deltas heat map y, count, and grouping attributes
- 6262ced8: fix: Fix crash when navigating away from chart explorer search page
- ec2ea566: Improve Support for Dynamic and JSON(<parameters>) Types
- 65872831: fix: Preserve original select from time chart event selection
- b46ae2f2: fix: Fix sidebar when selecting JSON property
- 62eddcf2: fix: Fix infinite querying on non-windowed searches
- 065cabdb: fix: Update "Copy Object" in line viewer to work with nested objects and arrays
- 05ca6ceb: Attempt to make claude code reviews less chirpy
- daffcf35: feat: Add percentages to filter values
- 5210bb86: refactor: clean up table connections
- 0cf179fa: Fixes typo in type definition
- b3448041: Add Sorting Feature to all search tables
- Updated dependencies [35c42222]
- Updated dependencies [b68a4c9b]
- Updated dependencies [5efa2ffa]
- Updated dependencies [43e32aaf]
- Updated dependencies [3c8f3b54]
- Updated dependencies [65872831]
- Updated dependencies [b46ae2f2]
- Updated dependencies [2f49f9be]
- Updated dependencies [daffcf35]
- Updated dependencies [5210bb86]
  - @hyperdx/common-utils@0.7.1

## 2.6.0

### Minor Changes

- 8a24c32a: Feat: add highlight animation for recently moved filter checkboxes
- 6c8efbcb: feat: Add persistent dashboard filters
- 54d30b92: feat: Add support for filter by parsed JSON string

### Patch Changes

- fa25a0c9: Improve search error isolation
- 8673f967: fix: json getKeyValues (useful for autocomplete)
- 69a2a6af: fix: 'Around a time' duration update in TimePicker
- ea5d2921: Improve memory efficiency in high row cound envs
- 24314a96: add dashboard import/export functionality
- 8f06ce7b: perf: add prelimit CTE to getMapKeys query + store clickhouse settings in shared cache
- e053c490: chore: Customize user-agent for Alerts ClickHouse client
- 7837a621: fix: Multiline support for WHERE Input boxes
- Updated dependencies [8673f967]
- Updated dependencies [4ff55c0e]
- Updated dependencies [816f90a3]
- Updated dependencies [24314a96]
- Updated dependencies [8f06ce7b]
- Updated dependencies [e053c490]
- Updated dependencies [6c8efbcb]
  - @hyperdx/common-utils@0.7.0

## 2.5.0

### Minor Changes

- 5a44953e: feat: Add new none aggregation function to allow fully user defined aggregations in SQL
- 0cf8556d: feat: Allow chart series to be reordered
- 970c0027: Fix: improve the discoverability of inline item expansion within the search table

### Patch Changes

- 7a058059: Reusable DBSqlRowTableWithSideBar Component
- 2c44ef98: style: Update icon used to show source schema
- 0d9f3fe0: fix: Always enable query analyzer to fix compatibility issues with old ClickHouse versions.
- 21f1aa75: fix: filter values for json casted to string
- 825452fe: refactor: Decouple alerts processing from Mongo
- 1d79980e: fix: Fix ascending order in windowed searches
- 0183483a: feat: Add source schema previews
- Updated dependencies [0d9f3fe0]
- Updated dependencies [3d82583f]
- Updated dependencies [5a44953e]
- Updated dependencies [1d79980e]
  - @hyperdx/common-utils@0.6.0

## 2.4.0

### Minor Changes

- deff04f6: Adds expandable log lines to search results tables
- fa45875d: Add delta() function for gauge metrics

### Patch Changes

- c48f4181: Add accordion functionality to filter groups, changed how the system prioritizes which filters are open by default, added new sort logic for prioritizing certain filters.
- 45e8e1b6: fix: Update tsconfigs to resolve IDE type errors
- d938b4a4: feat: Improve Slack Webhook validation
- 5c88c463: fix bug where reading value when server is offline could throw client error
- cd5cc7d2: fix: Fixed trace table source inference to correctly infer span events column
- Updated dependencies [45e8e1b6]
- Updated dependencies [fa45875d]
- Updated dependencies [d938b4a4]
- Updated dependencies [92224d65]
- Updated dependencies [e7b590cc]
  - @hyperdx/common-utils@0.5.0

## 2.3.0

### Minor Changes

- 25f77aa7: added team level queryTimeout to ClickHouse client
- 64eb638b: feat: Improve search speed by chunking long time range searches into smaller incremental search windows.

### Patch Changes

- c691e948: Improve the rendering of autocomplete suggestions in a modal context
- d6f8058e: - deprecate unused packages/api/src/clickhouse
  - deprecate unused route /datasources
  - introduce getJSNativeCreateClient in common-utils
  - uninstall @clickhouse/client in api package
  - uninstall @clickhouse/client + @clickhouse/client-web in app package
  - bump @clickhouse/client in common-utils package to v1.12.1
- fb66126e: fix: remove play button and time picker from markdown tab
- 88f3cafb: fix: Prevent empty order by set in search page for certain sort/primary keys
- 784014b6: fix: broke out line break icon from HyperJsonMenu
- 9c4c5f49: feat: support toUnixTimestamp style timestamps in ORDER BY
- aacd24dd: refactor: decouple clickhouse client into browser.ts and node.ts
- 52483f6a: feat: enable filters for json columns
- aacd24dd: bump: default request_timeout to 1hr
- 5e4047a9: feat: add generated SQL modal to the search page
- 042e3595: Resolved overflow issue and enhanced color contrast in nav bar profile section.
- a714412d: Improve live tail logic to not fetch if the page isn't visible.
- b6787d56: fix: format numbers on dashboards only for the queried column, not groupBy columns
- ecb20c84: feat: remove useless session source fields
- Updated dependencies [25f77aa7]
- Updated dependencies [d6f8058e]
- Updated dependencies [aacd24dd]
- Updated dependencies [52483f6a]
- Updated dependencies [aacd24dd]
- Updated dependencies [3f2d4270]
- Updated dependencies [ecb20c84]
  - @hyperdx/common-utils@0.4.0

## 2.2.2

### Patch Changes

- 56fd856d: fix: otelcol process in aio build
- Updated dependencies [56fd856d]
- Updated dependencies [0f242558]
  - @hyperdx/common-utils@0.3.2

## 2.2.1

### Patch Changes

- d29e2bc: fix: handle the case when `CUSTOM_OTELCOL_CONFIG_FILE` is not specified
- 5eeee5c: change app's docs links to ClickStack docs
- Updated dependencies [d29e2bc]
  - @hyperdx/common-utils@0.3.1

## 2.2.0

### Minor Changes

- c0b188c: Track the user id who created alerts and display the information in the UI.
- 6dd6165: feat: Display original query to error messages in search page

### Patch Changes

- 5ad1455: feat: centralize the default orderBy and optimize it for diverse table structures
- 823566f: chore: show display switcher on dashboard page
- 4c459dc: handle escaped string search correctly
- 35fe9cf: fix default order by generated for advanced table sorting keys
- 5a59d32: Upgraded NX from version 16.8.1 to 21.3.11
- 9cd9bfb: fix: Properly fetch tables in source edit dropdown when new connection is selected
- Updated dependencies [6dd6165]
- Updated dependencies [5a59d32]
  - @hyperdx/common-utils@0.3.0

## 2.1.2

### Patch Changes

- 39cde41: fix: k8s event property mappings
- b568b00: feat: introduce team 'clickhouse-settings' endpoint + metadataMaxRowsToRead setting
- 86115fa: feat: Add click + sidepanel support to items within surrounding context
- 7cd1d2a: fix: endless rerenders caused by Date.now() in a component
- ba86b0c: fix: Set default source in dropdown if one does not exist
- Updated dependencies [39cde41]
- Updated dependencies [b568b00]
  - @hyperdx/common-utils@0.2.9

## 2.1.1

### Patch Changes

- 1dc1c82: feat: add team setting to disable field metadata queries in app
- dc4a32c: feat: add text wrap to tables
- eed38e8: bump node version to 22.16.0
- 3bb11af: fix: Allow users to disable field fetching
- Updated dependencies [eed38e8]
  - @hyperdx/common-utils@0.2.8

## 2.1.0

### Minor Changes

- bb37520: Correlated source field links are bidirectional by default and no link exists.

### Patch Changes

- 4ce81d4: fix: handle Nullable + Tuple type column + decouple useRowWhere
- 6c13403: fix: use '--kill-others-on-fail' to prevent processes from terminating when RUN_SCHEDULED_TASKS_EXTERNALLY is enabled
- 61c79a1: fix: Ensure percentile aggregations on histograms don't create invalid SQL queries due to improperly escaped aliases.
- Updated dependencies [4ce81d4]
- Updated dependencies [61c79a1]
  - @hyperdx/common-utils@0.2.7

## 2.0.6

### Patch Changes

- 33fc071: feat: Allow users to define custom column aliases for charts
- b9ad3bd: fix: Limit source selector to only display the supported types in search, sessions and dashboards
- 10abadd: feat: Add verbose time range used for search in results table
- 40d0439: feat: Allow pinning a field in the filter panel
- 4581a68: fix: queries firing before having a valid table or connection id
- Updated dependencies [33fc071]
  - @hyperdx/common-utils@0.2.6

## 2.0.5

### Patch Changes

- 973b9e8: feat: Add any aggFn support, fix select field input not showing up
- 844f74c: fix: validate name for saved searches
- f7eb1ef: feat: configurable search row limit
- Updated dependencies [973b9e8]
  - @hyperdx/common-utils@0.2.5

## 2.0.4

### Patch Changes

- 52ca182: feat: Add ClickHouse JSON Type Support
- Updated dependencies [52ca182]
  - @hyperdx/common-utils@0.2.4

## 2.0.3

### Patch Changes

- b75d7c0: feat: add robust source form validation and error reporting
- a06c8cd: feat: Add download csv functionality to search tables
- 93e36b5: fix: remove id from post for connection creation endpoint
- Updated dependencies [b75d7c0]
- Updated dependencies [93e36b5]
  - @hyperdx/common-utils@0.2.3

## 2.0.2

### Patch Changes

- d1f4184: perf: improve performance on chart page and search page
- 8ab3b42: fix: fix demo instances for those with stale sources
- d1fc0c7: fix: change NEXT_PUBLIC_SERVER_URL to SERVER_URL
- eb9d009: feat: DBRowSidePanel global error boundary
- 73aff77: feat: Improve source editing UX
- 31e22dc: feat: introduce clickhouse db init script
- 2063774: perf: build next app in standalone mode to cut down images size
- 86fa929: Removed duplicate type definition.
- Updated dependencies [31e22dc]
- Updated dependencies [2063774]
  - @hyperdx/common-utils@0.2.2

## 2.0.1

### Patch Changes

- ab3b5cb: perf: merge api + app packages to dedupe node_modules
- ab387e1: fix: missing types in app build
- fce5ee5: feat: add load more to features and improve querying
- dfdb2d7: Better loading state for events patterns table
- 3eeb530: fix: date range undefined error causing issue loading keyvals for autocomplete
- 8874648: fix: Pollyfill crypto.randomUUID
- 43edac8: chore: bump @hyperdx/node-opentelemetry to v0.8.2
- Updated dependencies [ab3b5cb]
- Updated dependencies [ab387e1]
- Updated dependencies [fce5ee5]
  - @hyperdx/common-utils@0.2.1

## 2.0.0

### Major Changes

- 3fb3169: bumps to v2 beta

### Minor Changes

- 759da7a: Support multiple OTEL metric types in source configuration setup.
- 9579251: Stores the collapse vs expand status of the side navigation in local storage so it's carried across browser windows/sessions.
- 57a6bc3: feat: BETA metrics support (sum + gauge)

### Patch Changes

- 56e39dc: 36c3edc fix: remove several source change forms throughout the log drawer
- c60b975: chore: bump node to v22.16.0
- ab617c1: feat: support multiseries metrics chart
- 7de8916: Removes trailing slash for connection urls
- 3be7f4d: fix: input does not overlap with language select button anymore
- d176b54: fix: chartpage querying too on every keystroke after initial query
- 459267a: feat: introduce session table model form
- fe8ed22: fix: color display on search page for traces
- b3f3151: Allow to create Slack Webhooks from Team Settings page
- 2e350e2: feat: implement logs > metrics correlation flow + introduce convertV1ChartConfigToV2
- 321e24f: fix: alerting time range filtering bug
- 092a292: fix: autocomplete for key-values complete for v2 lucene
- a6fd5e3: feat: introduce k8s preset dashboard
- 2f626e1: fix: metric name filtering for some metadata
- cfdd523: feat: clickhouse queries are by default conducted through the clickhouse library via POST request. localMode still uses GET for CORS purposes
- 6dc6989: feat: Automatically use last used source when loading search page
- a9dfa14: Added support to CTE rendering where you can now specify a CTE using a full chart config object instance. This CTE capability is then used to avoid the URI too long error for delta event queries.
- fa7875c: feat: add summary and exponential histogram metrics to the source form and database storage
- 5a10ae1: fix: delete huge z-value for tooltip
- f5e9a07: chore: bump node version to v22
- b16c8e1: feat: compute charts ratio
- 6864836: fix: don't show ellipses on search when query is in-flight
- 86465a2: fix: map CLICKHOUSE_SERVER_ENDPOINT to otelcol ch exporter 'endpoint' field
- 08009ac: feat: add saved filters for searches
- 92a4800: feat: move rrweb event fetching to the client instead of an api route
- b99236d: fix: autocomplete options for dashboard page
- 43a9ca1: adopt clickhouse-js for all client side queries
- b690db8: Introduce event panel overview tab
- 7f0b397: feat: queryChartConfig method + events chart ratio
- 5db2767: Fixed CI linting and UI release task.
- 000458d: chore: GA v2
- 84a9119: fix: Session replay intermittently showing "No replay available for this session"
- 4514f2c: Remove connection health hook - too noisy
- 8d534da: fixed ui state on session panel to be inline with ui
- 931d738: fix: bugs with showing non otel spans (ex. clickhouse opentelemetry span logs)
- 2580ddd: chore: bump next to v13.5.10
- db761ba: fix: remove originalWhere tag from view. not used anyways
- 184402d: fix: use quote for aliases for sql compatibility
- 5044083: Session Replay tab for traces is disabled unless the source is configured with a sessionId
- 8c95b9e: Add search history
- a762203: fix: metadata getAllKeyValues query key scoped to table now
- cd0e4fd: fix: correct handling of gauge metrics in renderChartConfig
- b4b5f6b: style: remove unused routes/components + clickhouse utils (api)
- 1211386: add severitytext coloring to event patterns
- 6dafb87: fix: View Events not shown for multiple series; grabs where clause when single series
- e7262d1: feat: introduce all-one-one (auth vs noauth) multi-stage build
- decd622: fix: k8s dashboard uptime metrics + warning k8s event body
- e884d85: fix: metrics > logs correlation flow
- e5a210a: feat: support search on multi implicit fields (BETA)
- Updated dependencies [50ce38f]
- Updated dependencies [79fe30f]
- Updated dependencies [e935bb6]
- Updated dependencies [8acc725]
- Updated dependencies [2e350e2]
- Updated dependencies [321e24f]
- Updated dependencies [092a292]
- Updated dependencies [a6fd5e3]
- Updated dependencies [2f626e1]
- Updated dependencies [cfdd523]
- Updated dependencies [9c5c239]
- Updated dependencies [7d2cfcf]
- Updated dependencies [a9dfa14]
- Updated dependencies [fa7875c]
- Updated dependencies [b16c8e1]
- Updated dependencies [c50c42d]
- Updated dependencies [86465a2]
- Updated dependencies [e002c2f]
- Updated dependencies [b51e39c]
- Updated dependencies [759da7a]
- Updated dependencies [b9f7d32]
- Updated dependencies [92a4800]
- Updated dependencies [eaa6bfa]
- Updated dependencies [e80630c]
- Updated dependencies [4865ce7]
- Updated dependencies [29e8f37]
- Updated dependencies [43a9ca1]
- Updated dependencies [7f0b397]
- Updated dependencies [bd9dc18]
- Updated dependencies [5db2767]
- Updated dependencies [414ff92]
- Updated dependencies [000458d]
- Updated dependencies [0cf5358]
- Updated dependencies [99b60d5]
- Updated dependencies [931d738]
- Updated dependencies [57a6bc3]
- Updated dependencies [184402d]
- Updated dependencies [a762203]
- Updated dependencies [cd0e4fd]
- Updated dependencies [e7262d1]
- Updated dependencies [321e24f]
- Updated dependencies [96b8c50]
- Updated dependencies [e884d85]
- Updated dependencies [e5a210a]
  - @hyperdx/common-utils@0.2.0

## 2.0.0-beta.17

### Patch Changes

- c60b975: chore: bump node to v22.16.0
- d176b54: fix: chartpage querying too on every keystroke after initial query
- fe8ed22: fix: color display on search page for traces
- 321e24f: fix: alerting time range filtering bug
- fa7875c: feat: add summary and exponential histogram metrics to the source form and database storage
- 86465a2: fix: map CLICKHOUSE_SERVER_ENDPOINT to otelcol ch exporter 'endpoint' field
- 43a9ca1: adopt clickhouse-js for all client side queries
- 84a9119: fix: Session replay intermittently showing "No replay available for this session"
- 8d534da: fixed ui state on session panel to be inline with ui
- a762203: fix: metadata getAllKeyValues query key scoped to table now
- 1211386: add severitytext coloring to event patterns
- e7262d1: feat: introduce all-one-one (auth vs noauth) multi-stage build
- Updated dependencies [e935bb6]
- Updated dependencies [321e24f]
- Updated dependencies [7d2cfcf]
- Updated dependencies [fa7875c]
- Updated dependencies [86465a2]
- Updated dependencies [b51e39c]
- Updated dependencies [43a9ca1]
- Updated dependencies [0cf5358]
- Updated dependencies [a762203]
- Updated dependencies [e7262d1]
- Updated dependencies [321e24f]
- Updated dependencies [96b8c50]
  - @hyperdx/common-utils@0.2.0-beta.6

## 2.0.0-beta.16

### Patch Changes

- 931d738: fix: bugs with showing non otel spans (ex. clickhouse opentelemetry span logs)
- Updated dependencies [931d738]
  - @hyperdx/common-utils@0.2.0-beta.5

## 2.0.0-beta.15

### Patch Changes

- 7de8916: Removes trailing slash for connection urls
- cfdd523: feat: clickhouse queries are by default conducted through the clickhouse library via POST request. localMode still uses GET for CORS purposes
- 6dc6989: feat: Automatically use last used source when loading search page
- 92a4800: feat: move rrweb event fetching to the client instead of an api route
- 7f0b397: feat: queryChartConfig method + events chart ratio
- b4b5f6b: style: remove unused routes/components + clickhouse utils (api)
- Updated dependencies [79fe30f]
- Updated dependencies [cfdd523]
- Updated dependencies [92a4800]
- Updated dependencies [7f0b397]
  - @hyperdx/common-utils@0.2.0-beta.4

## 2.0.0-beta.14

### Patch Changes

- 56e39dc: 36c3edc fix: remove several source change forms throughout the log drawer
- 092a292: fix: autocomplete for key-values complete for v2 lucene
- 2f626e1: fix: metric name filtering for some metadata
- f5e9a07: chore: bump node version to v22
- b16c8e1: feat: compute charts ratio
- 08009ac: feat: add saved filters for searches
- db761ba: fix: remove originalWhere tag from view. not used anyways
- 8c95b9e: Add search history
- Updated dependencies [092a292]
- Updated dependencies [2f626e1]
- Updated dependencies [b16c8e1]
- Updated dependencies [4865ce7]
  - @hyperdx/common-utils@0.2.0-beta.3

## 2.0.0-beta.13

### Minor Changes

- 9579251: Stores the collapse vs expand status of the side navigation in local storage so it's carried across browser windows/sessions.

### Patch Changes

- 3be7f4d: fix: input does not overlap with language select button anymore
- 2e350e2: feat: implement logs > metrics correlation flow + introduce convertV1ChartConfigToV2
- a6fd5e3: feat: introduce k8s preset dashboard
- a9dfa14: Added support to CTE rendering where you can now specify a CTE using a full chart config object instance. This CTE capability is then used to avoid the URI too long error for delta event queries.
- 5a10ae1: fix: delete huge z-value for tooltip
- 6864836: fix: don't show ellipses on search when query is in-flight
- b99236d: fix: autocomplete options for dashboard page
- 5db2767: Fixed CI linting and UI release task.
- 2580ddd: chore: bump next to v13.5.10
- 5044083: Session Replay tab for traces is disabled unless the source is configured with a sessionId
- 6dafb87: fix: View Events not shown for multiple series; grabs where clause when single series
- decd622: fix: k8s dashboard uptime metrics + warning k8s event body
- e884d85: fix: metrics > logs correlation flow
- e5a210a: feat: support search on multi implicit fields (BETA)
- Updated dependencies [50ce38f]
- Updated dependencies [2e350e2]
- Updated dependencies [a6fd5e3]
- Updated dependencies [a9dfa14]
- Updated dependencies [e002c2f]
- Updated dependencies [b9f7d32]
- Updated dependencies [eaa6bfa]
- Updated dependencies [bd9dc18]
- Updated dependencies [5db2767]
- Updated dependencies [414ff92]
- Updated dependencies [e884d85]
- Updated dependencies [e5a210a]
  - @hyperdx/common-utils@0.2.0-beta.2

## 2.0.0-beta.12

### Patch Changes

- fix: use quote for aliases for sql compatibility
- Updated dependencies
  - @hyperdx/common-utils@0.2.0-beta.1

## 2.0.0-beta.11

### Minor Changes

- 759da7a: Support multiple OTEL metric types in source configuration setup.
- 57a6bc3: feat: BETA metrics support (sum + gauge)

### Patch Changes

- ab617c1: feat: support multiseries metrics chart
- 4514f2c: Remove connection health hook - too noisy
- cd0e4fd: fix: correct handling of gauge metrics in renderChartConfig
- Updated dependencies [8acc725]
- Updated dependencies [9c5c239]
- Updated dependencies [c50c42d]
- Updated dependencies [759da7a]
- Updated dependencies [e80630c]
- Updated dependencies [29e8f37]
- Updated dependencies [99b60d5]
- Updated dependencies [57a6bc3]
- Updated dependencies [cd0e4fd]
  - @hyperdx/common-utils@0.2.0-beta.0

## 2.0.0-beta.10

### Patch Changes

- 459267a: feat: introduce session table model form

## 2.0.0-beta.0

### Major Changes

- bumps to v2 beta

### Patch Changes

- b3f3151: Allow to create Slack Webhooks from Team Settings page
- b690db8: Introduce event panel overview tab

## 1.9.0

### Minor Changes

- 2488882: Allow to filter search results by event type (log or span)
- 1751b2e: Propogate isUTC and clock settings (12h/24h) across the app

### Patch Changes

- 4176710: autofocus on field select after setting a non-count aggfn
- e26a6d2: Add User Preferences modal
- 6d99e3b: New performant session replay playbar component
- ebd3f25: Reassign save search shortcut for Arc to CMD+SHIFT+S
- 25faa4d: chore: bump HyperDX SDKs (node-opentelemetry v0.8.0 + browser 0.21.0)
- ded8a77: fix: logtable scroll with highlighted line id
- 4af6802: chore: Remove unused dependencies
- 9c4f741: fix: threshold def of presence alert in alerts page
- 3b29721: Render JSON network body in a JSON viewer
- 3260f08: Allow to share open log in search dashboard tile
- da866be: fix: revisit doesExceedThreshold logic
- b192366: chore: bump node to v18.20.3
- 148c92b: perf: remove redundant otel-logs fields (timestamp + spanID +
  traceID)
- 47b758a: Confirm leaving Dashboard with unsaved changes
- 79d4f92: Hide HyperJson buttons when selecting value

## 1.8.0

### Minor Changes

- 4d6fb8f: feat: GA service health dashboard + metrics alert
- 0e365bf: this change enables generic webhooks. no existing webhook behavior
  will be impacted by this change.
- 4d6fb8f: feat: GA k8s dashboard / metrics side panel

### Patch Changes

- eefe597: Show client sessions with no user interactions but has recording by
  default
- b454003: feat: introduce conditional alert routing helper #is_match
- 05517dc: LogViewer: better JSON parsing and other tweaks
- d3e270a: chore: bump vector to v0.37.0
- ec95ef0: Add skip forward/back 15s buttons on session replay
- 2c61276: Allow exporting table chart results as CSV
- bc1e84b: Allow to interact with page while log side panel is open
- ab96e7c: Update Team Page layout and styling

## 1.7.0

### Minor Changes

- 396468c: fix: Use nuqs for ChartPage url query params

### Patch Changes

- dba8a43: Allow to drag and drop saved searches and dashhoards between groups
- 95ccfa1: Add multi-series line/table charts as well as histogram/number charts
  to the chart explorer.
- 095ec0e: fix: histogram AggFn values to be only valid ones (UI)
- 41d80de: feat: parse legacy k8s v1 cluster events
- f9521a5: Upgrade to React 18 and Next 13
- b87c4d7: fix: dense rank should be computed base on rank value and group
  (multi-series chart)
- 95f5041: Minor UI fixes
- a49726e: fix: cache the result conditionally (SimpleCache)
- b83e51f: refactor + perf: decouple and performance opt metrics tags endpoints

## 1.6.0

### Minor Changes

- ac667cd: Add Spotlight

### Patch Changes

- 82640b0: feat: implement histogram linear interpolation quantile function
- 8de2c5c: fix: handle py span ids
- 5d02cc3: Group saved searches and dashboards by tag
- 8de2c5c: feat: parse lambda json message
- 8919179: fix: Fixed parsing && and || operators in queries correctly
- cbdbe72: AppNav improvements
- 6321d1f: feat: support jk key bindings (to move through events)
- e92bf4f: fix: convert fixed minute unit granularity to Granularity enum
- 4a6db40: refactor: rename bulkInsertTeamLogStream to bulkInsertLogStream
- 8de2c5c: feat: add new k8s.pod.status_phase metrics
- 499c537: style: inject ingestor url (otel config file) + aggregator/go-parser
  url (ingestor config file) through env vars
- 8e536e1: chore: bump vector to v0.35.0

## 1.5.0

### Minor Changes

- a0dc1b5: Breaking Search Syntax Change: Backslashes will be treated as an
  escape character for a double quotes (ex. message:"\"" will search for the
  double quote character). Two backslashes will be treated as a backslash
  literal (ex. message:\\ will search for the backslash literal)

### Patch Changes

- b04ee14: feat: support multi group-bys in event series query
- f4360ed: feat: support count per sec/min/hr aggregation functions
- 7bc4cd3: feat: add last_value agg function
- d5fcb57: feat: introduce go-parser service
- 2910461: Bug fix: Restore dashboard filters, use correct field lookup for
  metrics, and remove extra log property type mapping fetches.
- 3c29bcf: feat: display hyperdx version at the bottom of app nav bar
- f618e02: Add CPU and Mem charts to Infra dashboard (with mock api)
- 4ee544c: Fix: Don't crash line chart when rendering numerical group values
- 725d7b7: 🔔 Introduces new alerts management page
- 9e617ed: ci: setup aggregator int tests
- 5f05081: feat: api to pull service + k8s attrs linkings
- dc88a59: fix: add db.normalized_statement default value
- ea9acde: Add Pods table to Infra dashboard
- 3e885bf: fix: move span k8s tags to root
- bfb08f8: perf: add index for pulling alert histories (GET alerts endpoint)
- 1b4607b: fix: services endpoint should return empty array if no custom fields
  found
- 8815eff: Placeholder page for Service Dashboard
- 08b06fa: Hide appnav banner when collapsed
- 95ddbb8: fix: services endpoint bug (missing log lines results in no matches)
- 76d7d73: fix: GET alerts endpoint

## 1.4.0

### Minor Changes

- 24afb09: Introduce Mantine.dev v6 Component Library
- 3b8effe: Add specifying multiple series of charts for time/line charts and
  tables in dashboard (ex. min, max, avg all in one chart).
- 60ee49a: Overhaul Properties viewer

### Patch Changes

- 9dc7750: fix: extend level inference scanning range
- 6d3cdae: Fix table chart link query formatting
- f65dd9b: Loading and error states for metrics dropdown
- af70f7d: Link Infrastructure Metrics with Events
- 8d1a949: perf: disable metrics property type mapping caching
- 423fc22: perf + feat: introduce SimpleCache and specify getMetricsTags time
  range
- 5e37a94: Allow to customize number formats in dashboard charts
- 807736c: Fix Headers parsing in Log Details
- 5b3b256: Show save badge in Dashboard page
- 72164a6: Limit Line Chart legend items
- 70f5fc4: Alerts page styling
- 58d928c: feat: transform k8s event semantic conventions
- 8159a01: Add K8s event tags
- ea20a79: Update Line Chart tooltip styling
- df7cfdf: Add new Legend renderer to MultiSeries chart
- b8133eb: feat: allow users to specify 'service.name' attr (flyio)
- 6efca13: Use Popover instead of Tooltip for line chart overflow

## 1.3.0

### Minor Changes

- ff38d75: feat: extract and ingest more metrics context (aggregation
  temporality, unit and monotonicity)
- 6f2c75e: refactor: split metrics chart endpoint `name` query param into `type`
  and `name` params (changing an internal API) feat: add validation for metrics
  chart endpoint using zod
- 8c8c476: feat: add is_delta + is_monotonic fields to metric_stream table
  (REQUIRES DB MIGRATION)
- 20b1f17: feat: external api v1 route (REQUIRES db migration) + Mongo DB
  migration script
- 9c2e279: feat: Log Side Panel styling
- e8c26d8: feat: time format ui addition

### Patch Changes

- ddd4867: Set up Storybook
- ddd4867: Sentry exceptions ui improvements
- 3a93196: Fix Sentry exception rendering error in side panel, add Sentry SDK to
  API server.
- a40faf1: Allow to set alerts for metric charts on development env
- f205ed5: feat: Add Sentry Integration section to Team Settings
- 2be709c: Revert adding Storybook
- 8c8c476: feat: setup clickhouse migration tool
- 77c1019: Show chart alert state (OK and ALERT)
- 4c0617e: Fix: Vertically resize session replayer
- 7784921: Fix: Don't crash session replay player when playback timestamp is not
  a valid date
- 242d8cc: Show custom actions in Session Replay events panel
- 713537d: Click on Table Tile to view all events
- 58a19fd: Set up ESLint rule for sorting imports
- abe3b12: Log Side Panel: exceptions ui improvements

## 1.2.0

### Minor Changes

- fe41b15: feat: Add dashboard delete confirmations and duplicate chart button
- bbda669: Chart alerts: add schemas and read path
- bf8af29: feat: Toggle columns from LogSidePanel
- 04f82d7: LogTable and LogSidePanel UI tweaks
- 0824ae7: API: Add support for chart alerts
- b1a537d: feat(register): password confirmation
- 8443a08: feat: implement CHART source alert (scheduled task)
- 283f32a: Chart alerts: connect UI to API
- 7d636f2: feat: enhanced registration form validation

### Patch Changes

- 9a72b85: fix: getLogBatchGroupedByBody missing return bug (regression)
- 956e5b5: chore: bump vector to v0.34.0
- 2fcd167: Chart alerts: Add UI to chart builder
- 640a5ba: fix: Chart alert default interval
- e904ec3: Refactor: Extract shared alert logic into a separate component

## 1.1.4

### Patch Changes

- 8cb0eac: Add rate function for sum metrics
- 4d24bfa: Add new version of the useTimeQuery hook along with a testing suite
- 8591aee: fix: control otel related services logs telemetry using
  HYPERDX_LOG_LEVEL

## 1.1.3

### Patch Changes

- 389bb3a: feat: support HYPERDX_LOG_LEVEL env var
- e106b75: style(ui): improve duration column representation
- 1ec122c: fix: aggregator errors handler status code
- 40ba7bb: enhancement - Persist log table column sizes to local storage

## 1.1.2

### Patch Changes

- bd37a5e: Filter out empty session replays from session replay search, add
  email filter to session replay UI
- 5d005f7: chore: bump @hyperdx/node-opentelemetry + @hyperdx/browser to latest
- 8b103f3: fix(app): negative duration in search

  Duration column in the search interface displayed negative numbers when only a
  timestamp was present. This fix changes the behavior to display "N/A" for such
  cases, clarifying that the duration is not applicable rather than displaying a
  misleading negative number.

- 911c02a: feat(app): enable cursor in session player
- 593c4ca: refactor: set output datetime format on the client side

## 1.1.1

### Patch Changes

- chore: bump @hyperdx/node-logger + @hyperdx/node-opentelemetry

## 1.1.0

### Minor Changes

- 914d49a: feat: introduce usage-stats service
