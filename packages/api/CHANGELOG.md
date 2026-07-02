# @hyperdx/api

## 2.29.0

### Minor Changes

- 9119de5f: Add unique MongoDB index on accessKey field in User model to eliminate full collection scans during API key authentication. This could cause startup failures if any existing users share duplicate accessKey values.
- 9f23b7e58: Feat: Added a V2 endpoint for team management.
- 5cd709020: Add UI support for configuring an external Prometheus-compatible endpoint on a
  connection. Modify Connections model to now have a boolean
  `isPrometheusEndpoint` field and use host for storing the host.
- b798f91f: Add connection management endpoints to the external API (`/api/v2/connections`), supporting list, get, create, update, and delete with Bearer token authentication. Passwords are write-only and never returned by the API.
- 63469fe0e: feat(mcp): first-class metric source support

  - Two new tools: `clickstack_list_metrics` paginates the metric-name catalog with optional kind / namePattern (ILIKE) / time-window filters and opaque cursor pagination; `clickstack_describe_metric` returns per-metric kind(s), unit, description, attribute keys, and sampled values (with kind auto-detection).
  - `clickstack_describe_source` is metric-aware: picks a representative metric table (gauge → sum → histogram), runs column / map-key / value-sampling against it, and adds a per-kind metric-name sample.
  - `clickstack_timeseries` and `clickstack_table` accept `metricType` (gauge / sum / histogram), `metricName`, and `isDelta` on each select item, plus `aggFn:"increase"` for Sum counters. `valueExpression` defaults to `"Value"` for metric sources. Surfaces the renderer's 20-group top-N cap on `increase + groupBy` as a neutral hint.
  - Dashboard prompt's "use raw SQL for metric tiles" workaround is replaced with positive discovery-workflow guidance and one worked example per supported kind.
  - `summary` and `"exponential histogram"` kinds remain out of scope (no query renderer support yet).

- f126d5b1: Support number-tile color authoring through the external dashboards API. The v2 REST API and OpenAPI spec now accept `color` (a palette token) and `colorRules` (ordered conditional color rules, last match wins) on builder number tiles, and `color` on raw SQL number tiles, matching what the in-product number-tile editor persists. Color rules accept the numeric and equality operators the editor offers (`gt`, `gte`, `lt`, `lte`, `between`, `eq`, `neq`). Existing dashboards keep working: tiles saved before the palette was renamed to hue names are normalized to the current token names on read.
- ebfc2e80a: Extend observability instrumentation to the remaining API surfaces using the
  shared helpers. Add custom metrics and tracing to previously log-only paths:
  OpAMP message handling (message outcomes, agent status reports, remote configs
  sent), the Prometheus proxy router (query duration + swallowed-error counters
  labeled by endpoint and backend), alert webhook/notification delivery (delivery
  attempts and duration labeled by service and outcome), and MongoDB connection
  lifecycle events.

  Add a reusable SLO primitive (`withOperationMetrics` / `recordOperationOutcome`)
  that emits standard availability + latency SLIs (`hyperdx.operation.requests`
  and `hyperdx.operation.duration_ms`, labeled by `operation` and `outcome`) so
  SLOs can be defined per piece of application functionality. Apply it to the AI
  assistant generation call, the ClickHouse proxy (query passthrough +
  connection test), and alert processing — both the end-to-end alert evaluation
  (`alerts.evaluate`, excluding scheduling skips) and its ClickHouse data fetch
  (`alerts.query`) — paths whose failures previously surfaced only as logs or
  failures-only counters with no latency or denominator.

- bbc29859d: Improve API observability instrumentation. Add a centralized tracing + metrics
  helper library (`withSpan`, `setBusinessContext`, `getStaticFeatureFlags`,
  memoized `getCounter`/`getHistogram`, `recordDuration`), attach consistent
  team/user/feature-flag context to traces across all auth paths (session,
  access-key, local mode), and add custom metrics for previously log-only hot
  paths: API errors, alert evaluation outcomes/query/process failures, and
  external API search/charts query duration and errors.
- 17e1eb19d: feat: Add an "external link" row-click action for dashboard table tiles

### Patch Changes

- 998ea5d0: feat: Add option to fit time chart y-axis lower bound
- 0497ca5dd: Bump http-proxy-middleware to v4, replacing http-proxy with httpxy
- ee907386: fix: Add sourceId to MCP Raw SQL Tile schema
- 9a7e392a: fix: Add missing numberFormats, compareToPreviousPeriod fields to MCP Schemas
- cdd7ca07: fix(mcp): reduce describe_source timeouts by using rollup tables for map key discovery
- d11991b0c: fix: enforce password complexity on team invite acceptance
- 8261b461: fix: inline parametric aggregate function arguments instead of passing as query parameters
- 973d1201b: fix: polish promql experience across the app
- 8164492f: fix(mcp): improve alias field descriptions and examples for readable chart legends
- a19ba549: feat(mcp): add patch_dashboard, get_dashboard_tile, search_dashboards tools

  Add three new MCP dashboard tools for granular operations:

  - `hyperdx_get_dashboard_tile` — retrieve a single tile by tileId
  - `hyperdx_patch_dashboard` — update name/tags and/or replace one tile
    without resubmitting the full dashboard
  - `hyperdx_search_dashboards` — search by name and/or tags

  Fix empty parameter schema on patch/search tools caused by Zod
  `.refine()` wrapping. Document Lucene substring matching limitations
  prominently in tool descriptions and query guide prompt.

  **Breaking (minor):** Tile `name` on `hyperdx_save_dashboard` now requires
  at least 1 character (`.min(1)`). Previously empty string `""` was accepted
  and silently persisted as a blank title. Callers sending `name: ""` will
  now receive a validation error.

- 7e7159a5: fix(mcp): improve error hints and fix readonly mode for query safety settings

  Switch MCP ClickHouse safety settings from readonly=1 to readonly=2 so
  max_execution_time and max_result_rows are actually applied (readonly=1
  silently rejects all setting changes).

  Improve DateTime64 cast error hint to recommend parseDateTime64BestEffort()
  which works on both DateTime and DateTime64 columns, replacing
  toDateTime64() which only works on DateTime64.

  Add error hint for unknown column/identifier errors directing agents to
  call describe_source before retrying.

- f34a31fdc: Support number-tile color in the MCP dashboard tools. `save_dashboard` and `patch_dashboard` now accept a static `color` and conditional `colorRules` on builder number tiles, and a static `color` on raw SQL number tiles, matching the external REST dashboards API.
- f6bda8c5: refactor(mcp): simplify ObjectId validation with shared helpers and schema-level checks

  Add `mcpError()` and `validateObjectId()` utilities to reduce boilerplate
  across MCP tool handlers. Move ObjectId validation into Zod input schemas
  for always-required ID fields, eliminating inline checks entirely. Remaining
  conditional checks use the new one-liner helper.

- f326ccf8: fix(mcp): quote multi-word aliases in orderBy and steer event-pattern usage

  Quote resolved aliases that are not bare identifiers (e.g. `"P95 Latency"`)
  in `resolveOrderBy` output, in both the direct alias-match and aggFn-match
  paths. Previously an unquoted multi-word alias produced SQL-invalid
  `ORDER BY` output. Incoming orderBy values are stripped of surrounding
  double-quote/backtick quoting before matching, so agents that already quote
  the alias resolve correctly without being double-quoted.

  Also document the alias-quoting requirement in the `orderBy` schema
  descriptions, and update the `clickstack_event_patterns` tool description to
  steer agents toward it (over `clickstack_search` / `clickstack_table`) when
  exploring what messages, errors, or events exist.

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
- f113ea36: fix(mcp): add ClickHouse safety settings (max_execution_time, max_result_rows, readonly) for MCP query execution
- 634101c33: chore: upgrade moduleResolution to NodeNext and simplify clickhouseProxy static import
- ba626ef96: Add `backgroundChart` support to number tiles in the external dashboards API (`/api/v2/dashboards`). Builder number tiles can now carry an optional background trend sparkline (`type` line or area, with an optional palette-token `color`) over the v2 REST API, matching the dashboard editor. Raw SQL number tiles do not support it.
- 60a91e43: fix(mcp): remove max_result_rows from MCP safety settings

  Remove the hardcoded max_result_rows=100000 setting from MCP query
  execution. Some ClickHouse connections impose profile constraints that
  cap max_result_rows below our default, causing SETTING_CONSTRAINT_VIOLATION
  errors. The remaining safety settings (max_execution_time=30, readonly=2)
  and trimToolResponse provide sufficient protection.

  Add a SETTING_CONSTRAINT_VIOLATION error hint so constrained settings
  surface actionable guidance instead of raw ClickHouse errors.

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

- adac913d: refactor(mcp): rename all MCP tool prefixes from `hyperdx_` to `clickstack_`

  Rename the MCP server name from `hyperdx` to `clickstack` and update all 19
  tool names (e.g. `hyperdx_search` → `clickstack_search`), along with
  descriptions, prompts, error messages, and test references.

- 1a64796c1: Removing relative imports and using path aliases
- 03f9dd70: feat: add an optional Section field to data sources

  Sources can now carry an optional free-text Section label, set from the source
  settings form. The value is persisted and returned by GET /api/v2/sources, so
  external API consumers can read it. This lays the groundwork for grouping and
  searching sources by section in the source selector.

- 6e0880a75: feat: Add Known Columns List setting for distributed tables
- fc3ef2dc: fix(alerts): populate `{{attributes.*}}` template variables for tile/chart alerts from group-by fields
- 81e524c2: feat(charts): cap group-by time charts to a top-N series limit to prevent browser memory exhaustion on high-cardinality group-bys. The cap defaults to 100 (the number of series rendered) and is configurable per team via a new "Time Chart Series Limit" setting; series beyond the cap remain available in the series selector.
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

- 9bbf68079: fix: bug preventing deletion of nested subdocuments like metadataMVs
- Updated dependencies [1d44098e5]
- Updated dependencies [998ea5d0]
- Updated dependencies [ee907386]
- Updated dependencies [5c46215f8]
- Updated dependencies [45954c318]
- Updated dependencies [5cd709020]
- Updated dependencies [5a1dde4d3]
- Updated dependencies [ae39bc436]
- Updated dependencies [8261b461]
- Updated dependencies [bf6e1f29]
- Updated dependencies [973d1201b]
- Updated dependencies [677e3f71]
- Updated dependencies [89949b1b]
- Updated dependencies [747352f3]
- Updated dependencies [750b8afe]
- Updated dependencies [caba7c255]
- Updated dependencies [f40cf686b]
- Updated dependencies [17e1eb19d]
- Updated dependencies [e03971b0]
- Updated dependencies [adac913d]
- Updated dependencies [1a64796c1]
- Updated dependencies [c74744a5]
- Updated dependencies [03f9dd70]
- Updated dependencies [6e0880a75]
- Updated dependencies [81e524c2]
- Updated dependencies [da3caab43]
- Updated dependencies [55a255a0a]
  - @hyperdx/common-utils@0.21.0

## 2.28.0

### Minor Changes

- 3123db53: feat: experimental promql support
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

### Patch Changes

- d1342121: feat(mcp): add hyperdx_describe_source tool and slim list_sources to catalog

  Add `hyperdx_describe_source` — returns full column schema, map attribute
  keys, and sampled low-cardinality values (SeverityText, StatusCode,
  ServiceName, etc.) for a single source. Uses existing rollup tables for
  performant value sampling.

  Slim `hyperdx_list_sources` to a lightweight MongoDB-only catalog (no
  ClickHouse queries). Source tools moved to a dedicated `tools/sources/`
  module.

  All query tool descriptions and prompts updated to reference the two-step
  `list_sources → describe_source` discovery workflow.

- a945fa07: feat(mcp): add hyperdx_event_deltas tool

  Add `hyperdx_event_deltas` MCP tool that compares two row groups (target
  vs baseline) and ranks properties by how much their value distributions
  differ. Same algorithm as the in-app Event Deltas view.

  Extract shared event-deltas algorithm from the UI into
  `@hyperdx/common-utils/src/core/eventDeltas.ts` so it can be used by
  both the frontend and the MCP server.

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

- c3a8aa55: feat(mcp): rewrite dashboard authoring prompts and expose `filters` on `hyperdx_save_dashboard`

  The `create_dashboard` prompt now leads with a design checklist (alias every select item including number tiles, schema gap on `groupBy` so tables don't render `arrayElement(SpanAttributes, '...')` as the column header, RED columns with aliases, per-series `numberFormat` for durations, `groupByColumnsOnLeft` for inventory tables, dashboard-level filters instead of per-tile `where` literals, one-metric-per-tile for metric sources, required containers at five or more tiles, post-save validation of every tile, no title-recap markdown). The wall-of-JSON canonical example is gone; the `dashboard_examples` patterns carry the concrete shapes.

  The `dashboard_examples` set is replaced with four verified patterns (`service_inventory`, `service_detail`, `log_analytics`, `backend_dependencies`) plus the existing `infrastructure_sql`. Each non-SQL example leads with a "When to use" header and a "Why this shape" note so the model picks by intent, not by surface keyword match. Examples were built and rendered on a live dev stack before landing.

  The `query_guide` prompt gains a `DASHBOARD FILTERS` section that documents the `filters: [{ type, name, expression, sourceId, where?, whereLanguage? }]` shape, a `NUMBER FORMAT` section that explains the per-series vs. chart-level distinction, and a `PER-TILE TYPE CONSTRAINTS` note that metric tiles take exactly one select item per tile.

  `hyperdx_save_dashboard` now accepts `filters` on its input schema, reusing `externalDashboardFilterSchemaWithId` so the MCP and REST surfaces stay in lockstep and the existing `convertExternalFiltersToInternal` helper handles the conversion without translation. Filters round-trip through create, get, and update.

  Voice pass: every prompt string is now em-dash-free.

- a4b9fa85: feat(mcp): improve MCP tool quality — error hints, shared helpers, better messages

  Extract duplicated ClickHouse error handling into a shared helper with
  pattern-matched error hints (DateTime64 casting, AS alias quoting, response
  size limits) so agents get actionable guidance on common failures. Add
  reusable mergeWhereIntoSelectItems() helper for consistent top-level where
  injection. Improve source/connection-not-found messages to suggest calling
  hyperdx_list_sources.

- 07911fd2: feat(mcp): add trace waterfall and breakdown tools

  Add `hyperdx_trace_waterfall` — fetch all spans in a single trace as a
  parent/child waterfall tree with optional correlated logs. Supports
  auto-pick by slowest, first error, or most recent trace.

  Add `hyperdx_trace_top_time_consuming_operations` — aggregate breakdown
  of child operations consuming the most cumulative time across traces
  matching a parent-span filter. Same algorithm as the in-app "Top Most
  Time Consuming Operations" chart.

- 04a5a925: feat: Add source scoping to dashboard filters
- 8810ff0f: feat: Add option for force-enabling/disabling text index support
- a8eb27dc: feat: filters reflect all values, not search aware; filters use metadata MVs if available
- Updated dependencies [3123db53]
- Updated dependencies [dcab1cb6]
- Updated dependencies [a945fa07]
- Updated dependencies [1df7583d]
- Updated dependencies [6a5ac3e3]
- Updated dependencies [e1c4381b]
- Updated dependencies [b30dfe0a]
- Updated dependencies [dcb85826]
- Updated dependencies [b5148c85]
- Updated dependencies [04a5a925]
- Updated dependencies [8810ff0f]
- Updated dependencies [a8eb27dc]
  - @hyperdx/common-utils@0.20.0

## 2.27.0

### Minor Changes

- fbe5a9a2: feat: Add POST /api/v2/search endpoint for querying raw log and trace rows programmatically

### Patch Changes

- f5ae0062: refactor(mcp): split hyperdx_query into 5 display-type-specific tools

  Replace the monolithic `hyperdx_query` tool with five narrow tools:

  - `hyperdx_timeseries` (line + stacked_bar)
  - `hyperdx_table` (table + number + pie, with shape auto-upgrade)
  - `hyperdx_search` (raw event browsing)
  - `hyperdx_event_patterns` (Drain pattern mining)
  - `hyperdx_sql` (raw ClickHouse SQL)

  Each tool's schema contains only its relevant parameters — no displayType
  discriminator, no fields from other modes, no conditional required fields.
  `hyperdx_query` is removed from the tool surface.

## 2.26.0

### Minor Changes

- 4c2c3f37: feat: add file-based dashboard provisioner that watches a directory for JSON files and upserts dashboards into MongoDB
- 46fe675b: feat(mcp): add alert, saved search, and webhook MCP tools

  Add five new MCP tools for managing alerts, saved searches, and webhooks:

  - `hyperdx_get_alert` / `hyperdx_save_alert` for listing, creating, and updating alerts
  - `hyperdx_get_webhook` for listing webhook destinations
  - `hyperdx_get_saved_search` / `hyperdx_save_saved_search` for listing, creating, and updating saved searches

  Also makes `McpContext.userId` required, rejecting MCP requests without a user ID.

### Patch Changes

- 7386f14b: Small improvements to MCP Server (Alert Names, Event Pattern Docs, Saved Search Improvements)
- 6c55978b: feat(alerts): include tileId in Slack alert URLs
- 46c1459b: refactor(api/alerts): route runtime values through the Handlebars view
- 40336e9e: feat: Add dashboard table onClick to MCP schemas and prompts
- Updated dependencies [84117a7a]
- Updated dependencies [51abe987]
  - @hyperdx/common-utils@0.19.1

## 2.25.0

### Minor Changes

- eb16df44: Add ability to disable data sources with improved UX
- 143f7a79: feat: Add per-series number formats
- f6a1d021: Add support for event patterns in MCP server, reduce code duplication
- 4d22d4ba: feat(api): support heatmap tiles in external dashboards API

  Heatmap is the only builder-mode display type that did not round-trip
  through the external dashboards API. The serializer dropped it into the
  "unsupported" fall-through, so creating, fetching, and updating heatmap
  tiles via `/api/v2/dashboards` lost the config. Heatmap now serializes
  and parses on both directions, with `valueExpression`,
  `countExpression`, `heatmapScaleType`, and `numberFormat` preserved
  across save/get. The heatmap select item does not expose `aggFn` or
  `alias`: the chart-level `displayType: "heatmap"` is the discriminator,
  the heatmap aggregation function is fixed internally, and
  `HeatmapSeriesEditor` does not render an alias input. Raw-SQL heatmap
  remains unsupported (heatmap rendering requires builder mode).

- 7d7269a7: feat: introducing rollup and source support for full autocomplete
- 4cc5eb3f: Add support for increase aggFn on sum counter metrics and rewrite sum metric rate computation to fix correctness issues.
- 41395ca7: External Dashboards API now round-trips the new dashboard organization
  layer added in #2015: `containers` on the dashboard, optional `tabs` on each
  container, and `containerId` / `tabId` on each tile. Create, get, list, and
  update all preserve the structure. The body validates that tile
  `containerId` references resolve to a real container, that tile `tabId`
  references resolve to a tab inside that container, and that tab ids are
  unique within a container. Container id uniqueness is already enforced by
  the shared schema. Dashboards saved without `containers` round-trip
  unchanged.
- 41eefec7: MCP `hyperdx_save_dashboard` now accepts the dashboard organization layer
  added in #2201: an optional `containers` array on the dashboard, plus
  `containerId` and `tabId` on each tile. The same five cross-field rules
  the external API enforces fire on the MCP path: container ids unique,
  tab ids unique within a container, tile.containerId resolves, tile.tabId
  resolves to a tab on that container, and tile.tabId requires
  tile.containerId. The MCP `buildQueryGuidePrompt` documents the new
  shape under a CONTAINERS AND TABS section.
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

### Patch Changes

- fecbfff7: fix: flatten MCP query tool schema so SDK serializes inputSchema correctly
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
- 29586e7b: Enable end-to-end PR testing on Vercel previews by inlining the Express API into the Next.js `/api/[...all]` serverless function (opt-in via `HDX_PREVIEW_INLINE_API=true`). Production deploys (Docker fullstack image, standalone Next output) are unchanged — they keep proxying `/api/*` to the separately-deployed API service.

  Also realigns `clickhouseProxy.ts` with the upstream EE implementation (modulo CHC and RBAC code paths): query params are now parsed from the request URL via `validateAndSanitizePath()` + `URL.searchParams` instead of `req.query`, which fixes a `Setting all is neither a builtin setting nor started with the prefix 'custom_'` regression on Vercel previews where Next.js's `[...all]` catch-all route polluted `req.query`. Adds path-injection hardening, POST-only enforcement, and exposes `X-ClickHouse-Mixed-Response` / `X-ClickHouse-Service-Unavailable` response headers for the browser ClickHouse client.

- 1c73d0c4: Add groupByColumnsOnLeft to MCP dashboard table tile schema
- 694e3c92: Increase MCP rate limit to 10 req/s
- eb7fdb4b: fix(api): tighten redactSecrets after deep-review on #2188

  Several security/correctness gaps surfaced by deep-review across
  two passes on the original redactSecrets PR.

  - The `bearer` value alphabet is now `\S+`. Real-world payloads
    carry plenty of opaque non-JWT bearers with `:`, `%`, or quote
    chars in them, and any alphabet narrower than `\S+` leaks the
    suffix past `[REDACTED]`. RFC 6750's b64token alphabet is a
    strict subset of `\S+`. (Same fix subsumes the earlier change
    that added `_` to cover JWT signatures.)
  - The `basic-auth-url` scheme allowlist now covers
    http(s) / ws(s) / ftp / sftp / ssh / postgres(ql) / mysql /
    mariadb / mongodb(+srv) / mssql / sqlserver / snowflake /
    redis(s) / amqp(s) / kafka(+ssl) / clickhouse / smtp(s) /
    ldap(s) / nats. The match is also case-insensitive (RFC 3986
    declares schemes case-insensitive), so `HTTPS://user:pw@host`
    no longer bypasses redaction.
  - The `llm-vendor-key` pattern now catches OpenAI ("sk-..."),
    Anthropic ("sk-ant-..."), and Google Gemini ("AIza..." with 35
    trailing chars). Without Gemini coverage, a Gemini API key in
    an observability payload would be exfiltrated to the very
    provider that issued it.

  Docstring scopes the redactor explicitly to LLM input. Tests
  cover each new shape, the JWT-with-underscore regression, the
  opaque-bearer-with-`:` / `%` regressions, the uppercase-scheme
  bypass, and the Gemini key shape.

- 9d5f14f3: feat: Add custom onClick field to external dashboards API
- 88b2b646: fix: use block_number/block_offset to uniquely identify log rows
- Updated dependencies [a5294f8d]
- Updated dependencies [eb16df44]
- Updated dependencies [24699cde]
- Updated dependencies [143f7a79]
- Updated dependencies [f6a1d021]
- Updated dependencies [aa1a8523]
- Updated dependencies [022fe893]
- Updated dependencies [7d7269a7]
- Updated dependencies [41395ca7]
- Updated dependencies [41395ca7]
- Updated dependencies [41395ca7]
- Updated dependencies [d3a5a575]
- Updated dependencies [5c6da48c]
- Updated dependencies [ef571cc0]
- Updated dependencies [c2a9f96f]
- Updated dependencies [a36c5b19]
- Updated dependencies [9d5f14f3]
- Updated dependencies [401dff5a]
  - @hyperdx/common-utils@0.19.0

## 2.24.1

### Patch Changes

- b73f6fcc: fix: Prevent duplicate tile IDs in dashboard imports
- 4c23e10a: feat: Allow displaying group-by columns on LHS of table
- Updated dependencies [b73f6fcc]
- Updated dependencies [4c23e10a]
- Updated dependencies [e2fc25da]
- Updated dependencies [7665fbe1]
  - @hyperdx/common-utils@0.18.1

## 2.24.0

### Minor Changes

- 9781ae63: Add an MCP (Model Context Protocol) server to the HyperDX API, enabling AI assistants (Claude, Cursor, OpenCode, etc.) to query observability data, manage dashboards, and explore data sources directly via standardized tool calls.
- 5885d479: Introduces Shared Filters, enabling teams to pin and surface common filters across all members.

### Patch Changes

- 1fada918: feat: Support alerts on Raw SQL Number Charts
- 7953c028: feat: Add between-type alert thresholds
- d3a61f9b: feat: Add additional alert threshold types
- 085f3074: feat: Implement alerting for Raw SQL-based dashboard tiles
- 3c057720: feat: Show alert execution errors in the UI
- 6ff1ba60: feat: Add alert history + ack to alert editor
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

## 2.23.1

### Patch Changes

- f8d2edde: feat: Show created/updated metadata for saved searches and dashboards
- Updated dependencies [24767c58]
  - @hyperdx/common-utils@0.17.1

## 2.23.0

### Minor Changes

- a15122b3: feat: new team setting for number of filters to fetch
- 941d0450: feat: support sample-weighted aggregations for sampled trace data

### Patch Changes

- 53ba1e39: feat: Add favoriting for dashboards and saved searches
- b7581db8: feat: Add more chart display units
- 59b1f46f: fix: Show alerts on a tile only when dashboard matches
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

- 470b2c29: ci: Replace QEMU with native ARM64 runners for release builds
- 275dc941: feat: Add conditions to Dashboard filters; Support filter multi-select
- 47e1f565: feat: Add OpenAI provider support for AI assistance
- 629009da: Update OpenAI model configuration to use the new Responses API
- acd117ab: perf: Optimize alerthistories aggregation queries to reduce DocDB CPU load
- Updated dependencies [4f7dd9ef]
- Updated dependencies [275dc941]
- Updated dependencies [6936ef8e]
  - @hyperdx/common-utils@0.16.2

## 2.22.0

### Patch Changes

- f410e6dc: Bump AI SDK to v6
- e05bd6b6: Include saved search filters in alert ClickHouse queries
- f5ce2329: ci: Add linting for openapi specs
- e09c8c0e: fix: query settings length validation
- 1381782b: feat: Support raw sql number charts and pie charts
- e2a82c6b: feat: Add Raw SQL Chart support to external dashboard APIs
- a345b83e: perf: optimize AlertHistory aggregation queries with time-window filters and compound index
- 74d92594: feat: Support fetching table metadata for Distributed tables
- ce850647: fix: change sources to discriminated union
- 359b5874: fix: add explicit api typing to all api routes and frontend hooks
- 25a3291f: feat: Attach service version to all internal telemetry
- a0b3361a: feat: unified hyperdx entrypoint script for API and alert task startup
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

- daab2cac: support saved query/filter values in external api
- 1bae972e: fix: allow any numeric value for alert thresholds
- fd9f290e: feat: Add query params, sorting, and placeholders to Raw-SQL tables
- dda0f9a4: feat: Add custom ORDER BY expression for Log and Trace sources
- 32f1189a: feat: Add RawSqlChartConfig types for SQL-based Table
- c5173ba2: fix: tile alerts with groupBy now correctly track and display group names
- cabe4d8e: fix: add whereLanguage to tile alerts
- 260c4299: feat: Improve validation of external alert API input
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

- 3e8cc729: feat: add alerts to number chart

### Patch Changes

- d760d2db: chore: Run integration tests on different ports
- fedd586b: feat: Remove potentially-sensitive fields from external webhooks API
- 54744093: fix: AI Notebook CH connections need to send pw
- 34c9afeb: feat: Add list webhooks API
- Updated dependencies [cd2b7a76]
- Updated dependencies [d760d2db]
- Updated dependencies [34c9afeb]
  - @hyperdx/common-utils@0.15.0

## 2.19.0

### Minor Changes

- 8326fc6e: feat: use optimization settings if available for use in CH

### Patch Changes

- cbe319c0: fix: use field as metricName in external metrics API when metricName is not provided
- b5bb69e3: fix: Improve Pie Chart implemententation
- Updated dependencies [8326fc6e]
  - @hyperdx/common-utils@0.14.0

## 2.18.0

### Minor Changes

- b676f268: feat: Add config property to external dashboard APIs. Deprecate series.

### Patch Changes

- 18e96904: fix: update required fields in our spec
- Updated dependencies [051276fc]
- Updated dependencies [4f1da032]
- Updated dependencies [b676f268]
  - @hyperdx/common-utils@0.13.0

## 2.17.0

### Patch Changes

- 679b65d7: feat: added configuration to disable frontend otel exporter
- 27f478a6: feat: Add external GET /sources API
- d759d046: support filters in dashboards external api
- a8aa94b0: feat: add filters to saved searches
- c3bc43ad: fix: Avoid using bodyExpression for trace sources
- 9ab68432: Minor fixes in the sources external API: 1. avoid inline schemas, 2. use short format timestamps for materializedView.minGranularity
- Updated dependencies [a8aa94b0]
- Updated dependencies [c3bc43ad]
  - @hyperdx/common-utils@0.12.3

## 2.16.0

### Patch Changes

- Updated dependencies [b6c34b13]
  - @hyperdx/common-utils@0.12.2

## 2.15.1

### Patch Changes

- 6cfa40a0: feat: Add support for querying nested/array columns with lucene
- Updated dependencies [6cfa40a0]
  - @hyperdx/common-utils@0.12.1

## 2.15.0

### Patch Changes

- Updated dependencies [f44923ba]
  - @hyperdx/common-utils@0.12.0

## 2.14.0

### Minor Changes

- 4c287b16: fix: Fix external dashboard endpoints
- 3aa8be0a: Concat zod errors into a single message field
- d07e30d5: Associates a logged in HyperDX user to the ClickHouse query recorded in the query log.

### Patch Changes

- 4e7d04c7: API: Show error "Invalid JSON payload" if the JSON body has a syntax error
- 941bc23e: fix: Fix inaccurate openapi docs for external alerts API
- b8ab312a: chore: improve Team typing
- Updated dependencies [6aa3ac6f]
- Updated dependencies [b8ab312a]
  - @hyperdx/common-utils@0.11.1

## 2.13.0

### Minor Changes

- bc8c4eec: feat: allow applying session settings to queries

### Patch Changes

- d769f88d: Fix issue when a source type is switched after creation
- 418828e8: Add better types for AI features, Fix bug that could cause page crash when generating graphs
- 79398be7: chore: Standardize granularities
- eef80b7e: Add ability to define different anthropic api BASE_URLs, add core logic for different ai providers
- 4a856173: feat: Add hasAllTokens for text index support
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

### Patch Changes

- ebaebc14: feat: Use materialized views in alert execution
- ac1a2f77: chore: Format OpenAPI docs
- 725dbc2f: feat: Align line/bar chart date ranges to chart granularity
- ae12ca16: feat: Add MV granularities and infer config from SummingMergeTree
- fd81c4cb: chore: bump MongoDB version to 5.0.32
- Updated dependencies [ab7645de]
- Updated dependencies [ebaebc14]
- Updated dependencies [725dbc2f]
- Updated dependencies [0c16a4b3]
  - @hyperdx/common-utils@0.10.2

## 2.11.0

### Patch Changes

- 103c63cc: chore(eslint): enable @typescript-eslint/no-unsafe-type-assertion rule (warn)
- Updated dependencies [103c63cc]
- Updated dependencies [103c63cc]
  - @hyperdx/common-utils@0.10.1

## 2.10.0

### Minor Changes

- a5a04aa9: feat: Add materialized view support (Beta)

### Patch Changes

- 96f0539e: feat: Add silence alerts feature
- e0c23d4e: feat: flush chunk data as it arrives if in order
- 50ba92ac: feat: Add custom filters to the services dashboard"
- b58c52eb: fix: Fix bugs in the Services dashboard
- 0d3da6f7: fix: case sensitivity issue with email invites
- 6d4fc318: feat: add teamsetting for paralellizing queries when possible
- Updated dependencies [ca693c0f]
- Updated dependencies [50ba92ac]
- Updated dependencies [a5a04aa9]
- Updated dependencies [b58c52eb]
  - @hyperdx/common-utils@0.10.0

## 2.9.0

### Minor Changes

- 52d27985: chore: Upgrade nextjs, react, and eslint + add react compiler

### Patch Changes

- cac4d3dd: Allow connecting to Mongo with AWS Auth
- b7789ced: chore: deprecate unused go-parser service
- e838436d: Improve value rounding on alerts to match thresholds
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
- 840d7307: feat: adjust alert template title and body to reflect alert state
- 94a669d3: Add metrics to task execution

### Patch Changes

- 99cb17c6: Add ability to edit and test webhook integrations
- 78aff336: fix: Group alert histories by evaluation time
- f612bf3c: feat: support incident.io integration
- f612bf3c: fix: handle group-by alert histories
- c4915d45: feat: Add custom trace-level attributes above trace waterfall
- a75ce3be: Fix check alert to actually honor concurrent evaluation.
- 44caf197: Zero-fill empty alert periods
- Updated dependencies [f612bf3c]
- Updated dependencies [f612bf3c]
- Updated dependencies [f612bf3c]
- Updated dependencies [c4915d45]
- Updated dependencies [6e628bcd]
  - @hyperdx/common-utils@0.8.0

## 2.7.1

### Patch Changes

- 24b5477d: feat: allow specifying webhook request headers
- c6ad250f: Enable auto-provisioning for no-auth mode
- 778092d3: fix: set a max size for alert timeranges
- Updated dependencies [2162a690]
- Updated dependencies [8190ee8f]
  - @hyperdx/common-utils@0.7.2

## 2.7.0

### Minor Changes

- f4c35239: Allows defining the ClickHouse request timeout value from the command line on the check-alert task
- 348a4044: migration: migrate to Pino for standardized and faster logging
- c90a93e6: Updated the cron package to pick up a fix for stalled cron tasks.

### Patch Changes

- c428d984: fix: Set team and connection attributes on span instead of trace
- 43e32aaf: fix: handle metrics semantic convention upgrade (feature gate)
- 131a1c1e: revert: api esbuild
- e032af55: Add new logging pararmeter for otel collector
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

- 6c8efbcb: feat: Add persistent dashboard filters

### Patch Changes

- 77d0e56f: chore: Add spans for alert processing
- e053c490: chore: Customize user-agent for Alerts ClickHouse client
- Updated dependencies [8673f967]
- Updated dependencies [4ff55c0e]
- Updated dependencies [816f90a3]
- Updated dependencies [24314a96]
- Updated dependencies [8f06ce7b]
- Updated dependencies [e053c490]
- Updated dependencies [6c8efbcb]
  - @hyperdx/common-utils@0.7.0

## 2.5.0

### Patch Changes

- df259392: chore: remove unused npm packages
- 0d9f3fe0: fix: Always enable query analyzer to fix compatibility issues with old ClickHouse versions.
- 140e4d2f: feat: Get ClickHouse client from AlertProvider
- 825452fe: refactor: Decouple alerts processing from Mongo
- Updated dependencies [0d9f3fe0]
- Updated dependencies [3d82583f]
- Updated dependencies [5a44953e]
- Updated dependencies [1d79980e]
  - @hyperdx/common-utils@0.6.0

## 2.4.0

### Patch Changes

- 45e8e1b6: fix: Update tsconfigs to resolve IDE type errors
- d938b4a4: feat: Improve Slack Webhook validation
- fd732a08: perf: Query AlertHistory in bulk
- 5d567b99: test: Add integration test for user removal alert updates
- d9b91124: fix: Update Alerts when creating user is deleted
- Updated dependencies [45e8e1b6]
- Updated dependencies [fa45875d]
- Updated dependencies [d938b4a4]
- Updated dependencies [92224d65]
- Updated dependencies [e7b590cc]
  - @hyperdx/common-utils@0.5.0

## 2.3.0

### Minor Changes

- 25f77aa7: added team level queryTimeout to ClickHouse client

### Patch Changes

- 85685801: feat: INGESTION_API_KEY allows for environment variable defined api key
- eb6f3a01: Fix the alert connection query to include the password field.
- d6f8058e: - deprecate unused packages/api/src/clickhouse
  - deprecate unused route /datasources
  - introduce getJSNativeCreateClient in common-utils
  - uninstall @clickhouse/client in api package
  - uninstall @clickhouse/client + @clickhouse/client-web in app package
  - bump @clickhouse/client in common-utils package to v1.12.1
- aacd24dd: refactor: decouple clickhouse client into browser.ts and node.ts
- bb2221a1: fix: Keep "created by" field unchanged during alert updates in dashboards
- aacd24dd: bump: default request_timeout to 1hr
- f800fd13: Fixes alert title used on dashboards with multiple tiles
- 261d4693: feat: limit how many tasks are executing at any time
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
- c216053: Changes the order of alert evaluation to group queries by the connection on the alert.
- Updated dependencies [d29e2bc]
  - @hyperdx/common-utils@0.3.1

## 2.2.0

### Minor Changes

- c0b188c: Track the user id who created alerts and display the information in the UI.

### Patch Changes

- ab50b12: feat: support custom otel collector config (BETA)
- ab50b12: fix: reduce bloat in opamp agent logs
- 5a59d32: Upgraded NX from version 16.8.1 to 21.3.11
- Updated dependencies [6dd6165]
- Updated dependencies [5a59d32]
  - @hyperdx/common-utils@0.3.0

## 2.1.2

### Patch Changes

- 39cde41: fix: k8s event property mappings
- b568b00: feat: introduce team 'clickhouse-settings' endpoint + metadataMaxRowsToRead setting
- Updated dependencies [39cde41]
- Updated dependencies [b568b00]
  - @hyperdx/common-utils@0.2.9

## 2.1.1

### Patch Changes

- 1dc1c82: feat: add team setting to disable field metadata queries in app
- eed38e8: bump node version to 22.16.0
- Updated dependencies [eed38e8]
  - @hyperdx/common-utils@0.2.8

## 2.1.0

### Patch Changes

- 4ce81d4: fix: handle Nullable + Tuple type column + decouple useRowWhere
- 21b5df6: fix: Hotfix to prevent the app from crashing due to a strict mode exception
- 6c13403: fix: use '--kill-others-on-fail' to prevent processes from terminating when RUN_SCHEDULED_TASKS_EXTERNALLY is enabled
- 61c79a1: fix: Ensure percentile aggregations on histograms don't create invalid SQL queries due to improperly escaped aliases.
- Updated dependencies [4ce81d4]
- Updated dependencies [61c79a1]
  - @hyperdx/common-utils@0.2.7

## 2.0.6

### Patch Changes

- 33fc071: feat: Allow users to define custom column aliases for charts
- Updated dependencies [33fc071]
  - @hyperdx/common-utils@0.2.6

## 2.0.5

### Patch Changes

- a4f2afa: fix: Add samesite to cookies for better security
- 844f74c: fix: validate name for saved searches
- f7eb1ef: feat: configurable search row limit
- Updated dependencies [973b9e8]
  - @hyperdx/common-utils@0.2.5

## 2.0.4

### Patch Changes

- 52ca182: feat: Add ClickHouse JSON Type Support
- 808145b: feat: specify NODE_ENV in api build (prod stage)
- Updated dependencies [52ca182]
  - @hyperdx/common-utils@0.2.4

## 2.0.3

### Patch Changes

- 93e36b5: fix: remove id from post for connection creation endpoint
- Updated dependencies [b75d7c0]
- Updated dependencies [93e36b5]
  - @hyperdx/common-utils@0.2.3

## 2.0.2

### Patch Changes

- ad68877: feat: bundle api via esbuild for smaller image distribution
- 707ba7f: chore: update deps for http-proxy-middleware
- 31e22dc: feat: introduce clickhouse db init script
- 2063774: perf: build next app in standalone mode to cut down images size
- Updated dependencies [31e22dc]
- Updated dependencies [2063774]
  - @hyperdx/common-utils@0.2.2

## 2.0.1

### Patch Changes

- ab3b5cb: perf: merge api + app packages to dedupe node_modules
- ab387e1: fix: missing types in app build
- d1dc2ec: Bumped mongodb driver support to allow for AWS IAM authentication. This drops support for MongoDB 3.6.
- 43edac8: chore: bump @hyperdx/node-opentelemetry to v0.8.2
- fa11fbb: fix: usage stats missing cluster id
- Updated dependencies [ab3b5cb]
- Updated dependencies [ab387e1]
- Updated dependencies [fce5ee5]
  - @hyperdx/common-utils@0.2.1

## 2.0.0

### Minor Changes

- 79fe30f: Queries depending on numeric aggregates now use the type's default value (e.g. 0) instead of null when dealing with non-numeric data.
- 759da7a: Support multiple OTEL metric types in source configuration setup.

### Patch Changes

- c60b975: chore: bump node to v22.16.0
- 50ce38f: Histogram metric query test cases
- 9004826: fix: remove total number of webhook limit
- 2e350e2: feat: implement logs > metrics correlation flow + introduce convertV1ChartConfigToV2
- 321e24f: fix: alerting time range filtering bug
- 9a9581b: Adds external API for alerts and dashboards
- e5dfefb: Added test cases for the webhook and source routes.
- fa7875c: feat: add summary and exponential histogram metrics to the source form and database storage
- f5e9a07: chore: bump node version to v22
- 59ee6d2: bring usage stats up to date
- 1674ab8: moved swagger to dependencies instead of devDependencies
- 86465a2: fix: map CLICKHOUSE_SERVER_ENDPOINT to otelcol ch exporter 'endpoint' field
- d72d1d2: Add ingestion key authentication in OTel collector via OpAMP
- b9f7d32: Refactored renderWith to simplify logic and ship more tests with the changes.
- 293a2af: Adds openapidoc annotations for spec generation and swagger route for development
- 92a4800: feat: move rrweb event fetching to the client instead of an api route
- adc2a0b: fix: Ensure errors from proxy are shown to the user
- 43a9ca1: adopt clickhouse-js for all client side queries
- 7f0b397: feat: queryChartConfig method + events chart ratio
- 5db2767: Fixed CI linting and UI release task.
- 000458d: chore: GA v2
- 99b60d5: Fixed sum metric query to pass integration test case from v1.
- 931d738: fix: bugs with showing non otel spans (ex. clickhouse opentelemetry span logs)
- 184402d: fix: use quote for aliases for sql compatibility
- cd0e4fd: fix: correct handling of gauge metrics in renderChartConfig
- d63deed: fix: support otelcol opamp for aio build
- b4b5f6b: style: remove unused routes/components + clickhouse utils (api)
- e7262d1: feat: introduce all-one-one (auth vs noauth) multi-stage build
- d326610: feat: introduce RUN_SCHEDULED_TASKS_EXTERNALLY + enable in-app task
- 96b8c50: Fix histogram query metric to support grouping and correct issues with value computation.
- 414ff92: perf + fix: single clickhouse proxy middleware instance
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
- 9004826: fix: remove total number of webhook limit
- 321e24f: fix: alerting time range filtering bug
- fa7875c: feat: add summary and exponential histogram metrics to the source form and database storage
- 59ee6d2: bring usage stats up to date
- 86465a2: fix: map CLICKHOUSE_SERVER_ENDPOINT to otelcol ch exporter 'endpoint' field
- d72d1d2: Add ingestion key authentication in OTel collector via OpAMP
- 43a9ca1: adopt clickhouse-js for all client side queries
- d63deed: fix: support otelcol opamp for aio build
- e7262d1: feat: introduce all-one-one (auth vs noauth) multi-stage build
- 96b8c50: Fix histogram query metric to support grouping and correct issues with value computation.
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

- 1674ab8: moved swagger to dependencies instead of devDependencies
- 931d738: fix: bugs with showing non otel spans (ex. clickhouse opentelemetry span logs)
- Updated dependencies [931d738]
  - @hyperdx/common-utils@0.2.0-beta.5

## 2.0.0-beta.15

### Minor Changes

- 79fe30f: Queries depending on numeric aggregates now use the type's default value (e.g. 0) instead of null when dealing with non-numeric data.

### Patch Changes

- 9a9581b: Adds external API for alerts and dashboards
- 293a2af: Adds openapidoc annotations for spec generation and swagger route for development
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

- e5dfefb: Added test cases for the webhook and source routes.
- f5e9a07: chore: bump node version to v22
- Updated dependencies [092a292]
- Updated dependencies [2f626e1]
- Updated dependencies [b16c8e1]
- Updated dependencies [4865ce7]
  - @hyperdx/common-utils@0.2.0-beta.3

## 2.0.0-beta.13

### Patch Changes

- 50ce38f: Histogram metric query test cases
- 2e350e2: feat: implement logs > metrics correlation flow + introduce convertV1ChartConfigToV2
- b9f7d32: Refactored renderWith to simplify logic and ship more tests with the changes.
- 5db2767: Fixed CI linting and UI release task.
- d326610: feat: introduce RUN_SCHEDULED_TASKS_EXTERNALLY + enable in-app task
- 414ff92: perf + fix: single clickhouse proxy middleware instance
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

### Patch Changes

- 99b60d5: Fixed sum metric query to pass integration test case from v1.
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

- adc2a0b: fix: Ensure errors from proxy are shown to the user

## 2.0.0-beta.0

## 1.9.0

### Minor Changes

- 2488882: Allow to filter search results by event type (log or span)

### Patch Changes

- 63e7d30: fix: Properly show session replays from very long sessions in client
  sessions search results
- 884938a: fix: doesExceedThreshold greater than logic
- 25faa4d: chore: bump HyperDX SDKs (node-opentelemetry v0.8.0 + browser 0.21.0)
- 288c763: fix: handle null ratio value (alerting)
- da866be: fix: revisit doesExceedThreshold logic
- b192366: chore: bump node to v18.20.3
- 148c92b: perf: remove redundant otel-logs fields (timestamp + spanID +
  traceID)

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
- d3e270a: chore: bump vector to v0.37.0
- 3b1fe08: feat + fix: add webhook endpoints validators + parse webhook JSON
  body
- 5fc7c21: feat: use handlebar to build up webhook body
- 4a85e22: chore: bump @clickhouse/client to v0.2.10

## 1.7.0

### Patch Changes

- 095ec0e: fix: histogram AggFn values to be only valid ones (UI)
- 41d80de: feat: parse legacy k8s v1 cluster events
- 7021924: Support '-', ';', '=', and '+' in password
- b87c4d7: fix: dense rank should be computed base on rank value and group
  (multi-series chart)
- a49726e: fix: cache the result conditionally (SimpleCache)
- b83e51f: refactor + perf: decouple and performance opt metrics tags endpoints

## 1.6.0

### Patch Changes

- 9c666fb: Fixed /api/v1/logs/chart from returning null values due to stale
  property type mappings
- 82640b0: feat: implement histogram linear interpolation quantile function
- 8de2c5c: fix: handle py span ids
- c5b1075: Add postGroupWhere filter option to /chart/series endpoint
- 8de2c5c: feat: parse lambda json message
- 8919179: fix: Fixed parsing && and || operators in queries correctly
- 6321d1f: feat: support jk key bindings (to move through events)
- e92bf4f: fix: convert fixed minute unit granularity to Granularity enum
- f10c3be: Add tags to Dashboards and LogViews
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
- 9e617ed: ci: setup aggregator int tests
- 5f05081: feat: api to pull service + k8s attrs linkings
- dc88a59: fix: add db.normalized_statement default value
- 3e885bf: fix: move span k8s tags to root
- bfb08f8: perf: add index for pulling alert histories (GET alerts endpoint)
- 1b4607b: fix: services endpoint should return empty array if no custom fields
  found
- 95ddbb8: fix: services endpoint bug (missing log lines results in no matches)
- 76d7d73: fix: GET alerts endpoint

## 1.4.0

### Minor Changes

- ce70319: chore: bump clickhouse client to v0.2.7
- 226a00d: feat: add state field to AlertHistory collection
- 3b8effe: Add specifying multiple series of charts for time/line charts and
  tables in dashboard (ex. min, max, avg all in one chart).
- 29d1e03: fix: infer log level by the order of severity

### Patch Changes

- 9dc7750: fix: extend level inference scanning range
- 8d1a949: perf: disable metrics property type mapping caching
- 423fc22: perf + feat: introduce SimpleCache and specify getMetricsTags time
  range
- 5e37a94: Allow to customize number formats in dashboard charts
- 619bd1a: fix: checkAlerts - add error handling
- 58d928c: feat: transform k8s event semantic conventions
- b8133eb: feat: allow users to specify 'service.name' attr (flyio)
- bb4f90d: Adjust time window for sum-rate alerts

## 1.3.0

### Minor Changes

- ff38d75: feat: extract and ingest more metrics context (aggregation
  temporality, unit and monotonicity)
- 6f2c75e: refactor: split metrics chart endpoint `name` query param into `type`
  and `name` params (changing an internal API) feat: add validation for metrics
  chart endpoint using zod
- 27f1b7e: feat: metrics alerting support
- 8c8c476: feat: add is_delta + is_monotonic fields to metric_stream table
  (REQUIRES DB MIGRATION)
- 20b1f17: feat: external api v1 route (REQUIRES db migration) + Mongo DB
  migration script
- e8c26d8: feat: time format ui addition

### Patch Changes

- 3a93196: Fix Sentry exception rendering error in side panel, add Sentry SDK to
  API server.
- 8c8c476: feat: setup clickhouse migration tool
- 141fce0: Filter out NaN values from metric charts

## 1.2.0

### Minor Changes

- bbda669: Chart alerts: add schemas and read path
- 0824ae7: API: Add support for chart alerts
- b1a537d: feat(register): password confirmation
- 8443a08: feat: implement CHART source alert (scheduled task)
- 7d636f2: feat: enhanced registration form validation

### Patch Changes

- 9a72b85: fix: getLogBatchGroupedByBody missing return bug (regression)
- 42969f2: chore: Add path aliases
- 956e5b5: chore: bump vector to v0.34.0
- f662007: Fixed Sum metric types from over reporting on sum and average aggFns
- 753a175: Fix typescript compilation with path aliases

## 1.1.4

### Patch Changes

- 8cb0eac: Add rate function for sum metrics
- 8591aee: fix: control otel related services logs telemetry using
  HYPERDX_LOG_LEVEL

## 1.1.3

### Patch Changes

- 389bb3a: feat: support HYPERDX_LOG_LEVEL env var
- 1ec122c: fix: aggregator errors handler status code

## 1.1.2

### Patch Changes

- bd37a5e: Filter out empty session replays from session replay search, add
  email filter to session replay UI
- 5d005f7: chore: bump @hyperdx/node-opentelemetry + @hyperdx/browser to latest
- 593c4ca: refactor: set output datetime format on the client side

## 1.1.1

### Patch Changes

- chore: bump @hyperdx/node-logger + @hyperdx/node-opentelemetry

## 1.1.0

### Minor Changes

- 914d49a: feat: introduce usage-stats service
