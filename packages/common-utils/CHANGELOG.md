# @hyperdx/common-utils

## 0.23.0

### Minor Changes

- ff05b3df: feat: Convert current builder config to SQL during editor switch

### Patch Changes

- 1705b37a: fix: Block webhook URLs targeting known-bad IP ranges
- 73819932: fix: Fix filter key fetching on version-mismatched distributed tables
- 7accfd2e: fix: support Group By on ratio charts

  A ratio chart (`seriesReturnType: 'ratio'`) with a Group By previously collapsed
  to a single line. Two issues in the multi-series merge: (1) rows were keyed by
  time bucket only, so groups at the same bucket overwrote each other, and (2) the
  ratio computation dropped every non-value column, discarding the group
  dimension. The merge now keys by (time bucket + group dimensions) and the ratio
  result carries the group columns through, so a grouped ratio renders one series
  per group.

  Grouped ratios use share-of-total semantics: each group's denominator is the
  total of the denominator column across all groups in the same time bucket, so
  the grouped lines are each group's contribution to the overall ratio and sum to
  the ungrouped value (e.g. each tenant's share of the overall error rate), rather
  than each group's in-group rate. Ungrouped ratios are unchanged (one row per
  bucket → the bucket total is that row's denominator). A group absent from the
  filtered numerator (e.g. a tenant with zero errors) contributes 0%, not N/A.

  Also fixed alongside grouped ratios:

  - A ratio whose two series resolve to the same value-column alias (e.g.
    `count(request)` filtered / unfiltered for an error rate) previously collapsed
    to one column and threw "Unable to compute ratio". The two operands are now
    kept distinct through the merge.
  - The chart-level Group By for metric sources offered the union of every
    series' fields, which could suggest a native column that exists in one metric
    table (e.g. gauge) but not another (e.g. sum), making that series' query fail.
    It now offers only fields valid for every series (the intersection).

## 0.22.0

### Minor Changes

- c29d0df23: feat: Add categorical bar chart display type
- ba598baba: feat: Add a custom ORDER BY input for Bar and Pie charts
- c29d0df23: feat: Allow specifying a limit on pie and bar chart series
- 3f1e1fe4: feat: update metrics schema for more efficient PK and time pruning
- 0c7254360: Adding consecutive-window configuration to alerts, so that you can specify a condition like "only fire this alert after some condition is met for N consecutive windows." This helps prevent flaky alerts (and pages), and cut down on alert noise in many cases.

  Also adds a `PENDING` alert state for alarms that _will_ fire if current trends continue.

### Patch Changes

- 617355378: Move the pinned-filter query parser (`parseQuery`) into `@hyperdx/common-utils`
  as the inverse of `filtersToQuery`, and add an `isRenderablePinnedFilter`
  helper. The app re-exports `parseQuery` from its previous location, so there is
  no behavior change in the UI. The helper lets the external saved-search API
  validate that a pinned filter will actually render as a sidebar facet (a
  `type: 'sql'` `<column> IN (...)` / `NOT IN` / `BETWEEN` predicate) and reject
  shapes that would be stored but never shown.
- e2145678d: fix: fixes the functions used to trigger direct_read
- bb7ae21e8: Upgrade the TypeScript devDependency from 5.9 to 6.0 across all packages.

## 0.21.0

### Minor Changes

- 5cd709020: Add UI support for configuring an external Prometheus-compatible endpoint on a
  connection. Modify Connections model to now have a boolean
  `isPrometheusEndpoint` field and use host for storing the host.
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

### Patch Changes

- 1d44098e5: fix: recover the SELECT-alias map when a query has ClickHouse-specific SQL the parser rejects

  `chSqlToAliasMap` returned an empty map whenever the rendered query contained
  SQL that node-sql-parser's Postgresql dialect cannot parse, for example a
  sampling CTE with `greatest(CAST(total / N AS UInt32), 1)`. An empty alias map
  drops the `WITH` clauses that define the source's select aliases, so filters on
  aliased columns (Event Patterns, histogram, alerts) failed with `Unknown
identifier`. It now falls back to parsing only the outer SELECT projection,
  which is all the alias map needs, so the aliases are recovered even when the
  rest of the statement is unparseable.

- 998ea5d0: feat: Add option to fit time chart y-axis lower bound
- ee907386: fix: Add sourceId to MCP Raw SQL Tile schema
- 5c46215f8: Bump `@clickhouse/client*` to `1.23.0-head.fae5998.1` and fix the type
  incompatibility it introduces.

  In `@clickhouse/client*` 1.23 each platform package (`@clickhouse/client`,
  `@clickhouse/client-web`) bundles its own copy of the shared types, so their
  `ClickHouseSettings` types — which reference the nominally-compared `SettingsMap`
  class — are no longer the same type as `@clickhouse/client-common`'s. The shared
  `processClickhouseSettings()` helper produces the `client-common` flavor, so
  assigning it into the per-platform clients' `query()` now requires an explicit
  bridge. Guard the existing `as ClickHouseSettings` assertions at those
  boundaries (`node.ts`, `browser.ts`, `cli`) with a scoped
  `@typescript-eslint/no-unsafe-type-assertion` disable, matching the existing
  "client library type mismatch" pattern. No runtime behavior changes.

- 45954c318: Import ClickHouse client types from the platform packages
  (`@clickhouse/client` / `@clickhouse/client-web`) instead of the deprecated
  `@clickhouse/client-common`. This makes the packages forward-compatible with
  `@clickhouse/client*` 1.23 (where `client-common` is deprecated and each
  platform package bundles and re-exports its own copy of the shared types)
  without bumping the pinned version. No runtime behavior changes.
- 5a1dde4d3: fix(search): wrap date column values in a type-matching parse/convert expression when building IN/NOT IN filters, so including/excluding a timestamp value no longer fails with "Cannot convert string ... to type DateTime64" or "Type mismatch in IN ... Expected: DateTime. Got: Decimal64". Date column types are now resolved from the query result set, so aliased (`TimestampTime AS time`) and computed (`toDate(TimestampTime)`) DateTime/Date columns are also wrapped correctly when added to filters.
- ae39bc436: fix: Correct filter handling for filter keys with special characters
- 8261b461: fix: inline parametric aggregate function arguments instead of passing as query parameters
- bf6e1f29: feat(charts): the time-chart series limit is now configured per chart in the Display Settings drawer instead of as a workspace-wide team setting (the team "Time Chart Series Limit" setting is removed). It is disabled by default — charts fetch every series and no `__hdx_series_limit` CTE is emitted — and is cleared back to disabled by emptying the field. The control only appears for builder line/bar charts; the limit and its Generated SQL preview now come from the chart's own config. When a limit is set, chunked time-chart queries keep a consistent top-N series set: previously each time-window chunk ranked its own top-N, so charts could render more series than the limit and adjacent windows disagreed; the ranking is now pinned to the newest chunk window for every chunk so the union across chunks equals the limit.
- 973d1201b: fix: polish promql experience across the app
- 677e3f71: fix: Skip rendering empty aggConditions
- 89949b1b: Adding filters to dashboard exports. Implemented validation on dashboard imports to catch potential issues with generated JSON or manually tweaked JSON.
- 747352f3: feat: add direct_read optimization for filters
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

- caba7c255: fix: Nudge agents towards macros in raw SQL tiles
- adac913d: refactor(mcp): rename all MCP tool prefixes from `hyperdx_` to `clickstack_`

  Rename the MCP server name from `hyperdx` to `clickstack` and update all 19
  tool names (e.g. `hyperdx_search` → `clickstack_search`), along with
  descriptions, prompts, error messages, and test references.

- 1a64796c1: Removing relative imports and using path aliases
- c74744a5: fix: fallback to body or implicit column expression when other empty
- 03f9dd70: feat: add an optional Section field to data sources

  Sources can now carry an optional free-text Section label, set from the source
  settings form. The value is persisted and returned by GET /api/v2/sources, so
  external API consumers can read it. This lays the groundwork for grouping and
  searching sources by section in the source selector.

- 6e0880a75: feat: Add Known Columns List setting for distributed tables
- 81e524c2: feat(charts): cap group-by time charts to a top-N series limit to prevent browser memory exhaustion on high-cardinality group-bys. The cap defaults to 100 (the number of series rendered) and is configurable per team via a new "Time Chart Series Limit" setting; series beyond the cap remain available in the series selector.
- da3caab43: Type JSON metadata filter attribute paths before value sampling.
- 55a255a0a: refactor(metrics): unify AttributesHash to variadic cityHash64 across Map and
  JSON metric schemas

  Sum / Gauge / Histogram metric queries now compute AttributesHash as
  `cityHash64(ScopeAttributes, ResourceAttributes, Attributes)` for both
  Map(LowCardinality(String), String) and JSON attribute columns. Previously
  the Map-schema path wrapped the three maps in `mapConcat()` before hashing,
  and the JSON-schema path used the variadic form; the schema-detection
  ClickHouse round-trip and the `attrHashExpr` helper / `isJsonSchema`
  plumbing are gone.

  Compatibility:

  - Per-row AttributesHash values change for every Map-schema metric row,
    but the hash is recomputed inside CTEs on every query — no materialized
    view, projection, ALIAS column, or cache persists it, so no downstream
    consumer is affected (audit: OSS only).
  - Cross-scope same-key behaviour shifts: two rows that carry the same
    logical key in different attribute scopes (e.g. `host` in
    `ResourceAttributes` for one emission and `host` in `Attributes` for the
    next) now hash distinctly and land in separate series. Previously the
    mapConcat path collapsed them into one series. This only matters when an
    OTel collector processor promotes attributes across scopes mid-stream;
    most SDKs emit attributes in stable scopes. The new behaviour is captured
    by an integration test in `packages/api/src/clickhouse/__tests__`.

  HDX-4466.

## 0.20.0

### Minor Changes

- feat: apply direct_read KV items optimization to SQL filters

  SQL `type: 'sql'` filters on Map columns (e.g.
  `LogAttributes['key'] IN ('a', 'b')`) now get the same `has()` /
  `hasAny()` rewrite that Lucene filters already use. When a KV items
  column with a `text(tokenizer=array)` skip index exists for the Map,
  the condition is rewritten at the filter site before rendering:

  - `Map['k'] = 'v'` → `has(Items, concat('k', '=', 'v'))`
  - `Map['k'] IN ('a', 'b')` → `hasAny(Items, array(concat('k', '=', 'a'), concat('k', '=', 'b')))`

  Empty-string values are left unrewritten to preserve ClickHouse's
  missing-key semantics (`Map(String, String)['absent'] = ''`).

  Also extracts `buildKvItemsLookup` from `CustomSchemaSQLSerializerV2`
  into a shared top-level export so both the Lucene serializer and the
  SQL filter rewriter can use the same lookup logic.

- 3123db53: feat: experimental promql support
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

- 1df7583d: feat: emit Lucene conditions from sidebar/dashboard filters to enable KV items direct_read optimization on Map columns

  Legacy `type: 'sql'` filters in URLs are automatically migrated to Lucene
  on page load. The persisted `DashboardFilter.expression` in MongoDB is unchanged.

### Patch Changes

- a945fa07: feat(mcp): add hyperdx_event_deltas tool

  Add `hyperdx_event_deltas` MCP tool that compares two row groups (target
  vs baseline) and ranks properties by how much their value distributions
  differ. Same algorithm as the in-app Event Deltas view.

  Extract shared event-deltas algorithm from the UI into
  `@hyperdx/common-utils/src/core/eventDeltas.ts` so it can be used by
  both the frontend and the MCP server.

- 6a5ac3e3: fix(charts): histogram bucket picks the highest-precision DateTime column when
  Timestamp Column lists multiple columns

  When a source's `Timestamp Column` listed multiple columns (e.g.
  `"EventDate, EventTime"` for partition-pruning), the histogram bucket was
  built from only the first token. If that token was a `Date` column, every
  row in a day collapsed into a single bar at midnight UTC of that day.

  The bucket resolver now walks the comma-split list, queries each column's
  type via metadata, and returns the highest-precision DateTime / DateTime64
  token. Date columns are skipped. If no DateTime-typed token is found, the
  original first-token behavior is preserved with a `console.warn`.

  The WHERE clause continues to use the multi-column form, so partition
  pruning via the `Date` column keeps working. The same resolved column is
  also used for the `argMin` / `argMax` / `min` / `max` time math in delta
  expressions.

  Fixes HDX-4371.

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

- b30dfe0a: fix: support text index on lower(Body) with no preprocessor
- dcb85826: fix: escape colons in Lucene field names so filters on Map sub-keys containing
  `:` (e.g. `LogAttributes['foo:bar']`) parse correctly

  `filtersToQuery` now backslash-escapes `:` and `\` in the emitted Lucene field
  name, and `parseLuceneFilter` + the SQL serializer decode those placeholders
  when consuming the AST so the original key is restored end-to-end.

- b5148c85: Dashboard table tiles configured with a row-click action now show a hover hint describing where the click will go (for example, `Search HyperDX Logs` or `Open dashboard "API Latency Drilldown"`). The cell wrapper is now a real link, so cmd-click and middle-click open the destination in a new tab, right-click shows the browser context menu with "Open in New Tab" and "Copy Link Address", and the destination URL appears in the browser status bar on hover. Keyboard users can Tab to a cell and press Enter to navigate, with a visible focus ring.
- 04a5a925: feat: Add source scoping to dashboard filters
- 8810ff0f: feat: Add option for force-enabling/disabling text index support
- a8eb27dc: feat: filters reflect all values, not search aware; filters use metadata MVs if available

## 0.19.1

### Patch Changes

- 84117a7a: fix: support CAST() form in KV items column expression parsing for direct_read optimization
- 51abe987: fix: Event Patterns and other CTE-using queries now correctly detect Date-typed partition columns and wrap them in toDate(), fixing "No results found" against sources with a Date partition key (e.g. event_date / EventDate).

## 0.19.0

### Minor Changes

- eb16df44: Add ability to disable data sources with improved UX
- 143f7a79: feat: Add per-series number formats
- 7d7269a7: feat: introducing rollup and source support for full autocomplete
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

### Patch Changes

- a5294f8d: fix: prevent false "data source not set" error on markdown dashboard tiles
- 24699cde: fix: Infer singular quantileXXX() from MV quantilesXXXState()
- f6a1d021: Add support for event patterns in MCP server, reduce code duplication
- aa1a8523: feat: adds optimization for lucene rendering based on a keyvalue concatenated Array(String)
- 022fe893: Fix issue with incorrect cache key being set in settings queries in nodejs
- 41395ca7: External Dashboards API: tighten validation around container/tab references
  on the v2 dashboards routes.

  - Cap tile `containerId` and `tabId` at 256 characters to mirror the
    internal `DashboardContainer` schema and the `DASHBOARD_CONTAINER_ID_MAX`
    constant, now exported from `@hyperdx/common-utils`.
  - Cap a single dashboard payload at 500 tiles via the new
    `DASHBOARD_MAX_TILES` constant to keep one request from pushing tens of
    MB into Mongo.
  - Treat empty-string `containerId` / `tabId` on legacy Mongo docs as
    absent on read, so dashboards predating the containers feature still
    round-trip through the external schema's `min(1)` cap.
  - Extract the cross-tile container/tab consistency check into a shared
    `validateDashboardContainersConsistency` helper so the canonical
    schema and the request body schema agree on what a valid payload is.
  - OpenAPI now publishes the matching `maxLength` and `maxItems` bounds
    on `DashboardContainer.id`, `DashboardContainerTab.id`, the
    `containers` array, and the request `tiles` array.

- 41395ca7: External Dashboards API: fix `PUT` round-trip when the request body omits
  `containers`, and self-heal orphan `containerId` / `tabId` references on
  read.

  - Move tile-level container/tab reference resolution out of the request
    body schema and into the `POST` and `PUT` handlers, so a `PUT` whose
    body omits `containers` validates tile refs against the existing
    dashboard's containers (the documented "preserve on omit" branch)
    rather than against an empty fallback. Without this, a `PUT` that
    changes only `tiles` while keeping a tile homed in a real preserved
    container was rejected with `Tile references unknown containerId`.
  - Split the shared validation helper into a structure-only pass
    (`validateDashboardContainersStructure`) and a tile-ref pass
    (`validateDashboardTileContainerRefs`) on
    `@hyperdx/common-utils`. The composite
    `validateDashboardContainersConsistency` now wraps both, so existing
    callers keep their current behavior.
  - On read, drop `tile.containerId` / `tile.tabId` when the ref does not
    resolve to a container (or tab) in the same dashboard. A pre-existing
    doc with an orphan ref now round-trips on `GET` as if the ref were
    absent, so the next `PUT` validates instead of failing with
    `Tile references unknown containerId`. Each drop is logged with the
    dashboard id, tile id, and the offending ref.
  - Document in the OpenAPI `PUT /api/v2/dashboards/{id}` description that
    the endpoint does not support optimistic concurrency. Concurrent PUTs
    may silently overwrite each other; clients should serialize edits to
    a given dashboard.

- 41395ca7: Internal refactor: move `validateDashboardContainersStructure` and
  `validateDashboardTileContainerRefs` (and their two helper types) out
  of `@hyperdx/common-utils/dist/types` into a new
  `@hyperdx/common-utils/dist/dashboardValidation` module. The `types`
  file now only contains types and type guards, matching the rest of the
  codebase. The previously exported `validateDashboardContainersConsistency`
  composite was only used by its own unit test and is dropped; production
  code in the v2 dashboards router uses the two underlying helpers
  directly. No behaviour change for callers of the external API.
- ef571cc0: feat: heatmap charts in chart editor and dashboards

  - Heatmap is now a selectable display type in the chart editor tabs
  - Dashboard tiles render heatmaps via the shared `DBHeatmapChart` component
  - Heatmap source picker restricted to trace sources; value/count expressions auto-populate from the source's duration expression
  - Display Settings drawer (scale, value, count) shared across search Event Deltas, chart editor, and dashboards
  - Click a dashboard heatmap tile to open Event Deltas with source, where clause, filters, and time range preserved
  - Dynamic Y-axis sizing measures formatted tick labels so long labels (e.g. "1.67min") are not clipped

- c2a9f96f: feat: Add more dashboard onClick linking options
- a36c5b19: feat: Add filter templating to custom dashboard on-click
- 9d5f14f3: feat: Add custom onClick field to external dashboards API
- 401dff5a: feat: Support import/export for dashboard onClicks

## 0.18.1

### Patch Changes

- b73f6fcc: fix: Prevent duplicate tile IDs in dashboard imports
- 4c23e10a: feat: Allow displaying group-by columns on LHS of table
- e2fc25da: feat: Add custom table onClick behavior
- 7665fbe1: refactor: Unify section/group into single Group with collapsible/bordered options

## 0.18.0

### Minor Changes

- 5885d479: Introduces Shared Filters, enabling teams to pin and surface common filters across all members.

### Patch Changes

- 418f70c5: Add Drain log template mining library (ported from browser-drain)
- 1fada918: feat: Support alerts on Raw SQL Number Charts
- 7953c028: feat: Add between-type alert thresholds
- d3a61f9b: feat: Add additional alert threshold types
- cc714f90: fix: Skip rendering empty SQL dashboard filter
- 085f3074: feat: Implement alerting for Raw SQL-based dashboard tiles
- 3c057720: feat: Show alert execution errors in the UI
- 6ff1ba60: feat: Add alert history + ack to alert editor

## 0.17.1

### Patch Changes

- 24767c58: fix: Ensure correct bounds for date-based timestampValueExpr

## 0.17.0

### Minor Changes

- a15122b3: feat: new team setting for number of filters to fetch
- 941d0450: feat: support sample-weighted aggregations for sampled trace data

### Patch Changes

- 518bda7d: feat: Add dashboard template gallery
- 4e54d850: fix: show Map sub-fields in facet panel for non-LowCardinality value types
- 53ba1e39: feat: Add favoriting for dashboards and saved searches
- b7581db8: feat: Add more chart display units
- 48a8d32b: fix: Fixed bug preventing clicking into rows with nullable date types (and other misc type) columns.
- a55b151e: fix: render clickhouse keywords properly in codemirror
- 308da30b: feat: Add $\_\_sourceTable macro
- e5c7fdf9: feat: Add saved searches listing page

## 0.16.2

### Patch Changes

- 4f7dd9ef: fix: Correctly detect text index with quoted tokenizer argument
- 275dc941: feat: Add conditions to Dashboard filters; Support filter multi-select
- 6936ef8e: fix: Enable materialized column optimization for expression alias CTEs

## 0.16.1

### Patch Changes

- 2fab76bf: fix: Keep toStartOf\* time filter bounds inclusive when dateRangeEndInclusive is false, preventing data from being dropped past hour/minute boundaries in time histograms
- e18f88c8: feat: Set enable_full_text_index=1 when available
- e09c8c0e: fix: query settings length validation
- 1381782b: feat: Support raw sql number charts and pie charts
- 74d92594: feat: Support fetching table metadata for Distributed tables
- 1d83bebb: feat: Add support for dashboard filters on Raw SQL Charts
- ce850647: fix: change sources to discriminated union
- 359b5874: fix: add explicit api typing to all api routes and frontend hooks
- 243e3baa: feat: Support fetching distributed table metadata with cluster()
- 4cee5d69: feat: Support ClickHouse datasource plugin macros in Raw SQL chart configs

## 0.16.0

### Minor Changes

- 902b8ebd: feat(alerts): add anchored alert scheduling with `scheduleStartAt` and `scheduleOffsetMinutes`

### Patch Changes

- 1bae972e: fix: allow any numeric value for alert thresholds
- fd9f290e: feat: Add query params, sorting, and placeholders to Raw-SQL tables
- dda0f9a4: feat: Add custom ORDER BY expression for Log and Trace sources
- 32f1189a: feat: Add RawSqlChartConfig types for SQL-based Table
- 3bc5abbf: fix: Reject wrapped toStartOf expressions in parseToStartOfFunction to prevent invalid SQL generation
- 1e6fcf1c: feat: Add raw sql line charts
- a13b60d0: feat: Support Raw SQL Chart Configs in Dashboard import/export

## 0.15.0

### Minor Changes

- cd2b7a76: fix: revert use_top_k_dynamic_filtering setting for issues with ORDER BY rand()

### Patch Changes

- d760d2db: chore: Run integration tests on different ports
- 34c9afeb: feat: Add list webhooks API

## 0.14.0

### Minor Changes

- 8326fc6e: feat: use optimization settings if available for use in CH

## 0.13.0

### Minor Changes

- 051276fc: feat: pie chart now available for chart visualization
- b676f268: feat: Add config property to external dashboard APIs. Deprecate series.

### Patch Changes

- 4f1da032: fix: clickstack build fixed when running same-site origin by omitting credentials from Authorization header for local mode fetch

## 0.12.3

### Patch Changes

- a8aa94b0: feat: add filters to saved searches
- c3bc43ad: fix: Avoid using bodyExpression for trace sources

## 0.12.2

### Patch Changes

- b6c34b13: fix: Handling non-monotonic sums

## 0.12.1

### Patch Changes

- 6cfa40a0: feat: Add support for querying nested/array columns with lucene

## 0.12.0

### Minor Changes

- f44923ba: feat: Add auto-detecting and creating OTel sources during onboarding

## 0.11.1

### Patch Changes

- 6aa3ac6f: fix: Fix missing negation in binary lucene expressions
- b8ab312a: chore: improve Team typing

## 0.11.0

### Minor Changes

- bc8c4eec: feat: allow applying session settings to queries

### Patch Changes

- 1cf8cebb: feat: Support JSON Sessions
- 418828e8: Add better types for AI features, Fix bug that could cause page crash when generating graphs
- 79398be7: chore: Standardize granularities
- 00854da8: feat: Add support for searching with bloom_filter(tokens()) indexes
- f98fc519: perf: Query filter values from MVs
- f20fac30: feat: force usage of the map key index with lucene rendered queries
- 4a856173: feat: Add hasAllTokens for text index support

## 0.10.2

### Patch Changes

- ab7645de: feat: Add a minimum date to MV configuration
- ebaebc14: feat: Use materialized views in alert execution
- 725dbc2f: feat: Align line/bar chart date ranges to chart granularity
- 0c16a4b3: feat: Align date ranges to MV Granularity

## 0.10.1

### Patch Changes

- 103c63cc: chore(eslint): enable @typescript-eslint/no-unsafe-type-assertion rule (warn)
- 103c63cc: refactor(common-utils): improve type safety and linting for type assertions

## 0.10.0

### Minor Changes

- ca693c0f: Add support for visualizing histogram counts
- a5a04aa9: feat: Add materialized view support (Beta)

### Patch Changes

- 50ba92ac: feat: Add custom filters to the services dashboard"
- b58c52eb: fix: Fix bugs in the Services dashboard

## 0.9.0

### Minor Changes

- 52d27985: chore: Upgrade nextjs, react, and eslint + add react compiler

### Patch Changes

- 586bcce7: feat: Add previous period comparisons to line chart
- ea25cc5d: fix: Support formatting queries with % operator
- b7789ced: chore: deprecate unused go-parser service
- ff422206: fix: Fix Services Dashboard Database tab charts
- 59422a1a: feat: Add custom attributes for individual rows
- 7405d183: bump typescript version
- 770276a1: feat: Add search to trace waterfall

## 0.8.0

### Minor Changes

- f612bf3c: feat: add support for alert auto-resolve

### Patch Changes

- f612bf3c: feat: support incident.io integration
- f612bf3c: fix: handle group-by alert histories
- c4915d45: feat: Add custom trace-level attributes above trace waterfall
- 6e628bcd: feat: Support field:(<term>...) Lucene searches

## 0.7.2

### Patch Changes

- 2162a690: feat: Optimize and fix filtering on toStartOfX primary key expressions
- 8190ee8f: perf: Improve getKeyValues query performance for JSON keys

## 0.7.1

### Patch Changes

- 35c42222: fix: Improve table key parsing
- b68a4c9b: Tweak getMapKeys to leverage one row limiting implementation
- 5efa2ffa: feat: handle k8s metrics semantic convention updates
- 43e32aaf: fix: handle metrics semantic convention upgrade (feature gate)
- 3c8f3b54: fix: Include connectionId in metadata cache key
- 65872831: fix: Preserve original select from time chart event selection
- b46ae2f2: fix: Fix sidebar when selecting JSON property
- 2f49f9be: fix: ignore max_rows_to_read for filter values distribution
- daffcf35: feat: Add percentages to filter values
- 5210bb86: refactor: clean up table connections

## 0.7.0

### Minor Changes

- 6c8efbcb: feat: Add persistent dashboard filters

### Patch Changes

- 8673f967: fix: json getKeyValues (useful for autocomplete)
- 4ff55c0e: perf: disable CTE if disableRowLimit flag is true (getKeyValues method)
- 816f90a3: fix: disable json filters for now
- 24314a96: add dashboard import/export functionality
- 8f06ce7b: perf: add prelimit CTE to getMapKeys query + store clickhouse settings in shared cache
- e053c490: chore: Customize user-agent for Alerts ClickHouse client

## 0.6.0

### Minor Changes

- 5a44953e: feat: Add new none aggregation function to allow fully user defined aggregations in SQL

### Patch Changes

- 0d9f3fe0: fix: Always enable query analyzer to fix compatibility issues with old ClickHouse versions.
- 3d82583f: fix issue where linting could fail locally
- 1d79980e: fix: Fix ascending order in windowed searches

## 0.5.0

### Minor Changes

- fa45875d: Add delta() function for gauge metrics

### Patch Changes

- 45e8e1b6: fix: Update tsconfigs to resolve IDE type errors
- d938b4a4: feat: Improve Slack Webhook validation
- 92224d65: Improve Intellisense on common-utils package
- e7b590cc: fix: Fix invalid valueExpression

## 0.4.0

### Minor Changes

- 25f77aa7: added team level queryTimeout to ClickHouse client

### Patch Changes

- d6f8058e: - deprecate unused packages/api/src/clickhouse
  - deprecate unused route /datasources
  - introduce getJSNativeCreateClient in common-utils
  - uninstall @clickhouse/client in api package
  - uninstall @clickhouse/client + @clickhouse/client-web in app package
  - bump @clickhouse/client in common-utils package to v1.12.1
- aacd24dd: refactor: decouple clickhouse client into browser.ts and node.ts
- 52483f6a: feat: enable filters for json columns
- aacd24dd: bump: default request_timeout to 1hr
- 3f2d4270: style: dedupe codes within \_\_query method and move createClient to the constructor
- ecb20c84: feat: remove useless session source fields

## 0.3.2

### Patch Changes

- 56fd856d: fix: otelcol process in aio build
- 0f242558: fix: Compatibilty with lowercase text skip index

## 0.3.1

### Patch Changes

- d29e2bc: fix: handle the case when `CUSTOM_OTELCOL_CONFIG_FILE` is not specified

## 0.3.0

### Minor Changes

- 6dd6165: feat: Display original query to error messages in search page

### Patch Changes

- 5a59d32: Upgraded NX from version 16.8.1 to 21.3.11

## 0.2.9

### Patch Changes

- 39cde41: fix: k8s event property mappings
- b568b00: feat: introduce team 'clickhouse-settings' endpoint + metadataMaxRowsToRead setting

## 0.2.8

### Patch Changes

- eed38e8: bump node version to 22.16.0

## 0.2.7

### Patch Changes

- 4ce81d4: fix: handle Nullable + Tuple type column + decouple useRowWhere
- 61c79a1: fix: Ensure percentile aggregations on histograms don't create invalid SQL queries due to improperly escaped aliases.

## 0.2.6

### Patch Changes

- 33fc071: feat: Allow users to define custom column aliases for charts

## 0.2.5

### Patch Changes

- 973b9e8: feat: Add any aggFn support, fix select field input not showing up

## 0.2.4

### Patch Changes

- 52ca182: feat: Add ClickHouse JSON Type Support

## 0.2.3

### Patch Changes

- b75d7c0: feat: add robust source form validation and error reporting
- 93e36b5: fix: remove id from post for connection creation endpoint

## 0.2.2

### Patch Changes

- 31e22dc: feat: introduce clickhouse db init script
- 2063774: perf: build next app in standalone mode to cut down images size

## 0.2.1

### Patch Changes

- ab3b5cb: perf: merge api + app packages to dedupe node_modules
- ab387e1: fix: missing types in app build
- fce5ee5: feat: add load more to features and improve querying

## 0.2.0

### Minor Changes

- 79fe30f: Queries depending on numeric aggregates now use the type's default value (e.g. 0) instead of null when dealing with non-numeric data.
- a9dfa14: Added support to CTE rendering where you can now specify a CTE using a full chart config object instance. This CTE capability is then used to avoid the URI too long error for delta event queries.
- e002c2f: Support querying a sum metric as a value instead of a rate
- 759da7a: Support multiple OTEL metric types in source configuration setup.
- e80630c: Add chart support for querying OTEL histogram metric table
- 57a6bc3: feat: BETA metrics support (sum + gauge)

### Patch Changes

- 50ce38f: Histogram metric query test cases
- e935bb6: ci: introduce release-nightly workflow
- 8acc725: Fixes to histogram value computation
- 2e350e2: feat: implement logs > metrics correlation flow + introduce convertV1ChartConfigToV2
- 321e24f: fix: alerting time range filtering bug
- 092a292: fix: autocomplete for key-values complete for v2 lucene
- a6fd5e3: feat: introduce k8s preset dashboard
- 2f626e1: fix: metric name filtering for some metadata
- cfdd523: feat: clickhouse queries are by default conducted through the clickhouse library via POST request. localMode still uses GET for CORS purposes
- 9c5c239: fix: handle 'filters' config (metrics)
- 7d2cfcf: fix: 'Failed to fetch' errors
- fa7875c: feat: add summary and exponential histogram metrics to the source form and database storage
- b16c8e1: feat: compute charts ratio
- c50c42d: add correlate log in trace waterfall chart
- 86465a2: fix: map CLICKHOUSE_SERVER_ENDPOINT to otelcol ch exporter 'endpoint' field
- b51e39c: fix: disable keep_alive on the browser side (ch client)
- b9f7d32: Refactored renderWith to simplify logic and ship more tests with the changes.
- 92a4800: feat: move rrweb event fetching to the client instead of an api route
- eaa6bfa: fix: transform partition_key to be the same format as others
- 4865ce7: Fixes the histogram query to perform quantile calculation across all data points
- 29e8f37: fix: aggCondition issue in sum/gauge/histogram metrics
- 43a9ca1: adopt clickhouse-js for all client side queries
- 7f0b397: feat: queryChartConfig method + events chart ratio
- bd9dc18: perf: reuse existing queries promises to avoid duplicate requests
- 5db2767: Fixed CI linting and UI release task.
- 414ff92: feat: export 'Connection' type
- 000458d: chore: GA v2
- 0cf5358: chore: bump clickhouse client to v1.11.1
- 99b60d5: Fixed sum metric query to pass integration test case from v1.
- 931d738: fix: bugs with showing non otel spans (ex. clickhouse opentelemetry span logs)
- 184402d: fix: use quote for aliases for sql compatibility
- a762203: fix: metadata getAllKeyValues query key scoped to table now
- cd0e4fd: fix: correct handling of gauge metrics in renderChartConfig
- e7262d1: feat: introduce all-one-one (auth vs noauth) multi-stage build
- 321e24f: feat: support 'dateRangeEndInclusive' in timeFilterExpr
- 96b8c50: Fix histogram query metric to support grouping and correct issues with value computation.
- e884d85: fix: metrics > logs correlation flow
- e5a210a: feat: support search on multi implicit fields (BETA)

## 0.2.0-beta.6

### Patch Changes

- e935bb6: ci: introduce release-nightly workflow
- 321e24f: fix: alerting time range filtering bug
- 7d2cfcf: fix: 'Failed to fetch' errors
- fa7875c: feat: add summary and exponential histogram metrics to the source form and database storage
- 86465a2: fix: map CLICKHOUSE_SERVER_ENDPOINT to otelcol ch exporter 'endpoint' field
- b51e39c: fix: disable keep_alive on the browser side (ch client)
- 43a9ca1: adopt clickhouse-js for all client side queries
- 0cf5358: chore: bump clickhouse client to v1.11.1
- a762203: fix: metadata getAllKeyValues query key scoped to table now
- e7262d1: feat: introduce all-one-one (auth vs noauth) multi-stage build
- 321e24f: feat: support 'dateRangeEndInclusive' in timeFilterExpr
- 96b8c50: Fix histogram query metric to support grouping and correct issues with value computation.

## 0.2.0-beta.5

### Patch Changes

- 931d738: fix: bugs with showing non otel spans (ex. clickhouse opentelemetry span logs)

## 0.2.0-beta.4

### Minor Changes

- 79fe30f: Queries depending on numeric aggregates now use the type's default value (e.g. 0) instead of null when dealing with non-numeric data.

### Patch Changes

- cfdd523: feat: clickhouse queries are by default conducted through the clickhouse library via POST request. localMode still uses GET for CORS purposes
- 92a4800: feat: move rrweb event fetching to the client instead of an api route
- 7f0b397: feat: queryChartConfig method + events chart ratio

## 0.2.0-beta.3

### Patch Changes

- 092a292: fix: autocomplete for key-values complete for v2 lucene
- 2f626e1: fix: metric name filtering for some metadata
- b16c8e1: feat: compute charts ratio
- 4865ce7: Fixes the histogram query to perform quantile calculation across all data points

## 0.2.0-beta.2

### Minor Changes

- a9dfa14: Added support to CTE rendering where you can now specify a CTE using a full chart config object instance. This CTE capability is then used to avoid the URI too long error for delta event queries.
- e002c2f: Support querying a sum metric as a value instead of a rate

### Patch Changes

- 50ce38f: Histogram metric query test cases
- 2e350e2: feat: implement logs > metrics correlation flow + introduce convertV1ChartConfigToV2
- a6fd5e3: feat: introduce k8s preset dashboard
- b9f7d32: Refactored renderWith to simplify logic and ship more tests with the changes.
- eaa6bfa: fix: transform partition_key to be the same format as others
- bd9dc18: perf: reuse existing queries promises to avoid duplicate requests
- 5db2767: Fixed CI linting and UI release task.
- 414ff92: feat: export 'Connection' type
- e884d85: fix: metrics > logs correlation flow
- e5a210a: feat: support search on multi implicit fields (BETA)

## 0.2.0-beta.1

### Patch Changes

- fix: use quote for aliases for sql compatibility

## 0.2.0-beta.0

### Minor Changes

- 759da7a: Support multiple OTEL metric types in source configuration setup.
- e80630c: Add chart support for querying OTEL histogram metric table
- 57a6bc3: feat: BETA metrics support (sum + gauge)

### Patch Changes

- 8acc725: Fixes to histogram value computation
- 9c5c239: fix: handle 'filters' config (metrics)
- c50c42d: add correlate log in trace waterfall chart
- 29e8f37: fix: aggCondition issue in sum/gauge/histogram metrics
- 99b60d5: Fixed sum metric query to pass integration test case from v1.
- cd0e4fd: fix: correct handling of gauge metrics in renderChartConfig

## 0.1.0

### Minor Changes

- 497fba8: Added support for querying gauge metric table with default detection for OTEL collector schema.

## 0.0.14

### Patch Changes

- 621bd55: feat: add session source and SourceKind enum

## 0.0.13

### Patch Changes

- b79433e: refactor: Extract alert configuration schema into AlertBaseSchema

## 0.0.12

### Patch Changes

- 418c293: feat: extract AlertChannelType to its own schema

## 0.0.11

### Patch Changes

- a483780: style: move types from renderChartConfig + add exceptions types

## 0.0.10

### Patch Changes

- fc4548f: feat: add alert schema + types
