# HyperDX Changelog

Release-level highlights across all HyperDX packages. Each entry is AI-generated
during the release and reviewed (and freely editable) in the "Release HyperDX"
PR — keep the `hyperdx-release-notes` comment marker intact when editing so your
edits survive regeneration. Per-package detail lives in each
`packages/*/CHANGELOG.md`.

## v2.34.0 — 2026-08-07

<!-- hyperdx-release-notes version=2.34.0 inputs=7f6d7242c74d -->

This release makes your HyperDX resources adoptable into infrastructure as code:
dashboards, saved searches and saved-search alerts gain an "Export to Terraform"
action, and Team Settings can download an import file covering the whole team.
Metrics sources can now point at a `series` table to accelerate metric queries, a
new `clickstack_emerging_signals` MCP tool tells an agent which log patterns are
newly emerging or have disappeared between two windows, and Prometheus-backed
connections gain an exemplar query endpoint. Search also got a round of
correctness fixes — `_` and `%` are literal characters again, every URL in a
query is escaped rather than just the first, and open or exclusive ranges no
longer fail outright. Time charts now cap high-cardinality tiles to a bounded
number of series with a load-all escape hatch — read the breaking change below
before upgrading a chart or an API client that relies on getting every series.

### 💥 Breaking Changes

- **Time charts cap high-cardinality series by default**: a tile grouped by a
  high-cardinality field no longer tries to draw every line — time charts now
  materialise and render a bounded number of series per tile, which keeps the
  browser responsive but means a chart that previously drew thousands of series
  now shows the top N. Escape hatches are built in: a "+N more" affordance in
  the hover and pinned tooltips, and a "load all series" action that lifts the
  cap for a chart. Tooltips also bound how many rows they render per frame, so a
  wide bucket can't mount thousands of popovers. Over the external dashboards
  API the per-tile series limit is a three-state value across tile types — omit
  it for the default cap, `0` for unlimited, or a positive N for the top N — so
  a client that relied on omitting the field to get every series should now send
  `0` (#2802).

### ✨ New Features

- **Export existing resources to Terraform**: dashboards, saved searches and
  saved-search alerts gain an "Export to Terraform" button showing a
  ready-to-paste `import {}` block plus collapsible provider setup, and a new
  "API & Agents" section in Team Settings downloads an import file covering
  dashboards, alerts, saved searches, sources, connections and webhooks. The
  export is import-only by design — resource configuration comes from
  `terraform plan -generate-config-out` reading through the ClickHouse provider,
  not from HyperDX. Dashboards carrying a tile the provider cannot represent, and
  PromQL sources, are reported as skipped rather than exported, and each listing
  caps at 1000 rows and tells you which types were capped so a large team knows
  its export is partial. Terraform addresses derive from resource ids rather than
  names, so renaming a resource and re-exporting won't produce a
  destroy-and-recreate plan (#2741).
- **Configure a `series` table to accelerate metrics**: metrics sources can now
  name a `series` table, giving metric queries a smaller table to resolve series
  from (#2763).
- **`clickstack_emerging_signals` MCP tool**: an agent can now diff mined log and
  event patterns between an earlier baseline window and the current one, surfacing
  which patterns are newly emerging and which have disappeared — a direct answer
  to "what changed?" during an incident (#2701).
- **Prometheus exemplar queries**: a new `/v1/prometheus/query_exemplars`
  endpoint proxies to Prometheus's native `/api/v1/query_exemplars` for
  Prometheus-backed connections, and answers with an empty success for
  ClickHouse-backed ones, where exemplars are read from the metric table instead.
  A wide dashboard range is narrowed to the supported exemplar window rather than
  rejected (#2806).
- **Replay a dashboard tile's query in Search**: log and trace tiles whose event
  query can be faithfully reconstructed gain a Replay search action, which opens
  a new Search tab with the tile's source, query, filters and the dashboard's
  time range preserved — so you can go from a spike on a dashboard to the events
  behind it without rebuilding the query by hand (#2648).

### 🔧 Improvements

- **"What's new" shows the cross-package release summary**: the in-app changelog
  now renders the release-level highlights from the root changelog instead of the
  app-only package changelog, so you see the whole release rather than just the
  frontend changes (#2737).
- **`seriesLimit` over the external API and MCP**: the top-N series cap on line
  and stacked bar tiles is now readable and settable through External API v2 and
  MCP, so a dashboard authored by an agent can carry the same series cap as one
  built in the UI (#2772).
- **The row side panel remembers your tab**: opening the next row keeps you on
  the tab you were working in — Column Values, say — instead of resetting to
  Overview, including when you pick a neighbouring row out of Surrounding
  Context. Navigations that target a specific tab (such as View Trace) still win,
  and a remembered tab a row doesn't offer falls back to that row's default
  (#2752).
- **"View Trace" is easier to spot in the log side panel**: the action is now a
  right-aligned outlined button with the trace source icon instead of subtle
  inline text in the dimmed metadata row. The first time you open a log that has
  a correlated trace, a one-time popover points you at the button; acknowledging
  it ("Got it") or clicking View Trace dismisses it for good on that browser
  (#2815).
- **Chart tooltips and legends behave better**: a new "Show All Series" button
  clears a focused series, tooltip action buttons no longer render behind the
  tooltip, the legend's "+N more" list is capped in height and scrolls, and chart
  hover tooltips no longer paint over the date range picker (#2822, #2803).
- **Percentile context in the heatmap tooltip**: hovering a heatmap cell now
  shows where that bucket sits in the distribution (#2789).
- **Only supported aggregations offered for histogram metrics**: the chart
  builder hides aggregation functions a Histogram metric can't use, so you no
  longer pick one and get an error back (#2793).
- **Prometheus proxy responses hardened and failures counted**: every proxied
  response is relabelled `application/json` and carries
  `X-Content-Type-Options: nosniff` — set before anything can return, so the
  proxy's own error bodies get it too — since a member-configured connection host
  otherwise returns untrusted content on your origin. Proxy failures now
  increment `prometheusQueryErrors`, counted on 5xx only so malformed PromQL
  doesn't read as a backend fault, where all four proxied endpoints previously
  reported zero errors; a client that navigates away mid-body no longer counts as
  a backend error either (#2806).
- **Theme refinements**: primary HyperDX buttons use the solid brand green rather
  than a subtle tinted fill, tab lists get a true 1px line with matching 1px
  hover borders on inactive tabs, code blocks use the dedicated code background
  token, and the segmented control's active indicator gains a border, small
  radius and its own background (#2814).
- **Clearer `SELECT *` error state on distributed tables**: the error is easier
  to act on and now also shows on expanded rows (#2771).

### 🐛 Bug Fixes

- **`_` and `%` in a search term are literal again**: search terms were
  interpolated straight into the ILIKE pattern, so ClickHouse read them as
  wildcards — `ServiceName:user_service` also matched `user-service` and
  `user.service`, and the negated `-ServiceName:user_service` dropped those same
  rows. Token-index lookups still receive the raw term (#2774).
- **Every URL in a search is escaped, not just the first**: a query naming two or
  more URLs left the later colons unescaped, so Lucene read them as field
  queries — `http://a.com http://b.com` compiled the second URL to
  `http ILIKE '%//b.com%'`, a predicate on a bare `http` identifier rather than a
  search of the log body (#2764).
- **Open, exclusive and non-numeric range bounds are honoured**:
  `Duration:[* TO 500]` compiled to `Duration BETWEEN '*' AND 500`, which
  ClickHouse rejects with `TYPE_MISMATCH`; exclusive and half-open ranges like
  `Duration:{100 TO 500}` were all serialised as an inclusive `BETWEEN`; and
  bounds parsed with `parseFloat` turned
  `Timestamp:[2024-01-01 TO 2024-06-01]` into `BETWEEN 2024 AND 2024`, matching
  nothing. The plain-English explanation of a search now marks excluded bounds
  too (#2779).
- **Timestamp columns carrying a timezone or type wrapper are detected**:
  `DateTime('UTC')` wasn't classified as a DateTime, so a source listing both a
  `Date` partition column and a `DateTime` column bucketed charts on the `Date`,
  collapsing a whole day into one bar at midnight. Time filters now also wrap
  bounds in `toDate()` for `Date32` and `Nullable(Date)` columns, which
  previously lost the entire start day (#2780).
- **Series limits rank by the plotted ratio**: a chart using the "ratio" series
  return type with a series limit ranked its top-N by the bare numerator, so a
  low-volume group with a high ratio could lose its slot to a high-volume group
  with a much lower one. Ranking now uses the same division the chart displays;
  non-ratio charts generate identical SQL to before (#2759).
- **Query results no longer lose rows**: when ClickHouse's streamed response
  headers spanned two chunks, the result rows that followed were dropped
  (#2766).
- **SQL expressions containing escaped quotes split correctly**: a
  backslash-escaped quote no longer causes an expression to be split in the wrong
  place (#2767).
- **Rate limits are keyed on the access key**: the external API and MCP limiters
  bucketed on the raw `Authorization` header value, and because any text is
  accepted before `Bearer `, varying that prefix handed each request a fresh
  quota. Limits now key on the access key itself, falling back to the client IP
  when a request carries no usable key (#2781).
- **Invitation revocation is scoped to your team**:
  `DELETE /team/invitation/:id` deleted by id alone, so any authenticated user
  who knew an id could revoke another team's pending invitation. Unknown or
  out-of-team ids now return 404. `Authorization` and `Cookie` headers are also
  redacted from API request logs (#2741).
- **Updating a missing alert or dashboard returns not-found**: updates against an
  id that doesn't exist now answer 404 rather than appearing to succeed, so an
  API client can tell a real write from a no-op (#2784, #2768).
- **Changing an alert's source clears stale references**: source-specific fields
  left behind by the previous source are cleared instead of pointing at
  something the new source doesn't have (#2783).
- **Searching a log attached to a trace works from the Traces view**: clicking
  "Search" on a log while viewing its trace raised a SQL error instead of running
  the search against the log's own source (#2825).
- **"View Trace" row lookups are bounded to a time window**: the side panel's
  lookup for the row behind a trace is now scoped to a time range instead of
  being left open-ended, so it resolves without scanning a large source end to
  end (#2816).
- **Search no longer defaults to an incompatible source**: the search page won't
  pre-select a source whose kind it can't search (#2769).
- **Metric tables are only auto-detected when the database changes**: table
  auto-detection no longer re-runs on unrelated edits to a metrics source, so the
  tables you picked stay picked (#2817).
- **Assorted polish**: relative timestamps abbreviate every unit, so lists no
  longer mix `5m ago` with `2 years ago` or render `3mo.s ago` (#2773), and long
  values in the JSON attributes viewer no longer paint over the key column
  (#2813).

<!-- hyperdx-package-list -->

### 📦 Package changelogs

- `@hyperdx/api` 2.33.0 → 2.34.0 — [changelog](https://github.com/hyperdxio/hyperdx/blob/main/packages/api/CHANGELOG.md#2340)
- `@hyperdx/app` 2.33.0 → 2.34.0 — [changelog](https://github.com/hyperdxio/hyperdx/blob/main/packages/app/CHANGELOG.md#2340)
- `@hyperdx/common-utils` 0.24.1 → 0.25.0 — [changelog](https://github.com/hyperdxio/hyperdx/blob/main/packages/common-utils/CHANGELOG.md#0250)
- `@hyperdx/hdx-eval` 0.3.0 → 0.3.1 — [changelog](https://github.com/hyperdxio/hyperdx/blob/main/packages/hdx-eval/CHANGELOG.md#031)
- `@hyperdx/otel-collector` 2.33.0 → 2.34.0 — [changelog](https://github.com/hyperdxio/hyperdx/blob/main/packages/otel-collector/CHANGELOG.md#2340)

<!-- /hyperdx-package-list -->

## v2.32.0 — 2026-07-27

<!-- hyperdx-release-notes version=2.32.0 inputs=backfill -->

This release makes traces easier to follow across service boundaries: the span
detail panel now surfaces OpenTelemetry span links, so you can hop straight into
a linked trace and step back through a breadcrumb trail without leaving the
panel. Search filters and autocomplete also got smarter about rollup tables,
routing queries through the best available rollup for faster results. Dashboards
pick up per-column colour rules on table tiles, a new Sessions and Memory
section in the Browser RUM dashboard, and a snap grid while you drag tiles
around. Operators sending webhooks to internal hosts should read the validation
change below before upgrading.

### 💥 Breaking Changes

- **Stricter, standardised webhook URL validation**: webhook destinations are
  now consistently checked against SSRF protections, so deliveries to private or
  reserved addresses are blocked by default. If you deliver webhooks to an
  internal host, add it to the new `WEBHOOK_HOSTNAME_ALLOWLIST` setting
  (comma-separated; a hostname entry also covers its subdomains, while IPv4/IPv6
  entries match exactly). The allowlist does not bypass protocol validation,
  Slack hostname validation, or the block on your configured ClickHouse and
  MongoDB hosts (#2672).

### ✨ New Features

- **OpenTelemetry span links in the trace view**: the span detail panel gains a
  "Span Links" section showing each link's trace state and attributes as chips,
  with an "Open trace" action that opens the linked trace in place and a
  breadcrumb trail you can step back through. Trace sources gain an optional
  `spanLinksValueExpression` field, auto-detected from the OTel `Links` column
  (#2463).
- **Per-column colours on dashboard table tiles**: set a static colour on any
  column of a builder table tile, or layer ordered conditional rules (for
  example `> 500` turns the cell red) — the table-cell counterpart of
  number-tile colouring. Colours use the existing palette tokens, so they reflow
  correctly across light and dark themes (#2517).
- **Sessions and Memory in the Browser RUM dashboard**: a Recent Sessions table
  lists client-side sessions with page views, errors, distinct traces, user,
  service and last-active time, and clicking a row drills through to Traces
  filtered to that session. New per-page JS heap tiles (median and p90 used
  heap, plus a Memory by Page table) come from `performance.memory.*` attributes
  on `documentLoad` spans — Chromium visitors only, and they need a Browser SDK
  build that emits those attributes (#2673).
- **"What's new" in the Help menu**: open the app's changelog, rendered as
  Markdown, without leaving HyperDX (#2684).

### 🧪 Experimental

- **Exponential histogram metrics**: quantiles can now be computed over
  exponential histograms, and these metrics appear in the metric name drop-down
  and are queryable through the MCP server. The UI is gated behind
  `NEXT_PUBLIC_ENABLE_EXPONENTIAL_HISTOGRAMS` (#2697, #2705, #2687).

### 🔧 Improvements

- **Filters and autocomplete route through the best rollup**: suggestion and
  filter queries now pick the most appropriate rollup table automatically, so
  autocomplete stays responsive on high-volume sources (#2643).
- **Clearer trace and span detail layout**: long attribute values with no break
  points now wrap fully in wrap mode instead of being clipped, long attribute
  keys wrap and are capped at half the row width so they can't squeeze out the
  value column, and a new toggle moves the span detail panel between the right
  side (default) and the bottom of the waterfall. Overview and Column Values
  content now aligns flush with the tab bar (#2693).
- **Easier-to-scan table tiles**: an always-on separator keeps a table tile's
  sticky header distinct as rows scroll underneath, and a new Alternate Row
  Background display setting (off by default) zebra-stripes wide tables. Both
  work in light and dark modes (#2519).
- **Snap grid while moving dashboard tiles**: dragging or resizing a tile now
  draws the grid behind the tiles and highlights the cells where the tile will
  actually land, including when the grid compacts it away from the cursor
  (#2715).
- **Detail drawers close when you click outside them**: on Search and Sessions,
  clicking outside the results table or session list dismisses the open drawer,
  while clicks inside the drawer, its nested popups and modals, or the results
  table keep it open (#2682).
- **Semantic colour variants across the UI**: `Text` gains `warning` and
  `success` variants and `Alert` gains `info`, `success`, `warning` and
  `danger`, backed by new scheme-aware subtle background tokens — lighter tints
  in light mode, deeper tints in dark. Text colours are tuned to meet WCAG AA
  (4.5:1) on those tints in both HyperDX and ClickStack themes (#2704).
- **MCP tool spans identify the calling client**: tool-invocation spans now
  carry the MCP client's name and version, making it easier to tell which
  assistant issued a query (#2700).

### 🐛 Bug Fixes

- **Multi-select search box clears after you pick a value**: the search input in
  virtualised multi-selects no longer keeps the previous term, so the next
  option you want isn't filtered out (#2676).
- **Codex CLI MCP install snippet corrected**: the setup instructions now use
  the current `codex mcp add --url … --bearer-token-env-var …` syntax (#2699).

## v2.31.0 — 2026-07-17

<!-- hyperdx-release-notes version=2.31.0 inputs=backfill -->

Charts are the headline of this release: clicking a point on any time chart now
pins its tooltip in place with drill-down actions built right in, and the
out-of-the-box Browser RUM dashboard has been rebuilt around Core Web Vitals
with colour-coded tiles and background sparklines. Ratio charts finally honour
Group By, so you can break an error rate down by tenant or service. There are
also two hardening fixes for alert webhooks and a fix for grouped alerts that
could get permanently stuck in the ALERT state.

### ✨ New Features

- **Pinned tooltips with inline drill-down on time charts**: hovering a chart
  shows a passive tooltip with per-series values and previous-period change;
  clicking pins it in place and reveals the drill-down actions inline — "View
  All Events" plus per-series Drill in, Copy name and Focus. On the search page,
  Focus now applies the series as a real search filter so the chart and the
  results list narrow together, and drill-downs open in a new tab so you keep
  your current view. Dismiss the pinned tooltip with the X, an outside click, or
  Escape (#2642, #2611).
- **Revamped Browser RUM dashboard**: the built-in dashboard is now organised
  into Core Web Vitals, Load Time, Traffic & Page Views, and Errors. Tiles are
  colour-coded by value — Core Web Vitals use Google's good / needs-improvement
  / poor thresholds, page load tiles use latency bands, and error tiles turn
  amber when any errors are present — with a legend tile documenting the
  thresholds. Every single-value tile also renders a faint background sparkline
  so you can see the metric's trend at a glance (#2671, #2675).
- **Switching from the query builder to SQL now carries your query across**: the
  current builder configuration is converted to SQL when you switch editors, and
  the selected source is preserved instead of being reset (#2634, #2666).

### 🔧 Improvements

- **Clearer selected source in the source picker**: the dropdown now marks the
  current source with a trailing check and a persistent highlight, and spaces
  options out for readability (#2651).

### 🐛 Bug Fixes

- **Group By now works on ratio charts**: a ratio chart with a Group By
  previously collapsed to a single line. Grouped ratios now render one series
  per group using share-of-total semantics — each group's contribution to the
  overall ratio, summing to the ungrouped value. Ratios whose two series
  resolved to the same column alias (for example filtered vs unfiltered
  `count(request)`) no longer fail with "Unable to compute ratio", and the
  chart-level Group By for metric sources now only offers fields valid across
  every series (#2538).
- **Grouped alerts no longer get stuck in the ALERT state**: history state now
  resets to OK once thresholds are no longer exceeded, so a grouped alert
  recovers instead of firing indefinitely (#2624).
- **Alert webhook delivery hardened**: webhook URLs targeting known-bad IP
  ranges are blocked, and redirects are no longer followed when delivering
  webhooks (#2593, #2668).
- **Side panel controls render correctly in the error state** (#2637).
- **No more duplicate ticks in the trace waterfall and minimap** (#2652).

### 📦 Build / Packaging

- **Recharts upgraded from 2.13 to 3.x**: chart event handling (zoom-brush
  selection, click drill-down) and tooltip pinning were reworked onto the
  Recharts 3 API, and the browser focus ring that Recharts 3 shows on click is
  suppressed. No action needed, but chart interactions have been touched broadly
  (#2610).

## v2.30.1 — 2026-07-13

<!-- hyperdx-release-notes version=2.30.1 inputs=backfill -->

This release is a small patch release for `@hyperdx/app`. The headline fix
resolves a bug where saving changes to an existing saved-search alert silently
did nothing; multi-select fields also gained support for freeform text entry,
and a Docker image build issue introduced by the recent TypeScript 6 upgrade has
been resolved.

### 🔧 Improvements

- **Freeform text in multi-select fields**: Multi-select inputs
  (`VirtualMultiSelect`) now accept freeform text entries in addition to the
  predefined options, making it easier to enter custom values that aren't in the
  list.

### 🐛 Bug Fixes

- **Fixed "Save Alert" doing nothing when editing an existing alert**: Editing a
  saved-search alert and clicking Save previously failed silently — the form
  rejected the alert's persisted `numConsecutiveWindows: null` value and looked
  up the alert id from an unregistered field. Saving edited alerts now works as
  expected.

### 📦 Build / Packaging

- **Fixed a Docker image build failure**: The recent TypeScript 6 upgrade added
  ambient CSS module declarations needed for the build, but the Dockerfiles
  didn't copy that file into the build stage, breaking `next build` inside the
  container. The app image now builds correctly again.

## v2.30.0 — 2026-07-10

<!-- hyperdx-release-notes version=2.30.0 inputs=backfill -->

This release is all about quieter alerting and faster trace reading. Alerts can
now require a condition to hold for several consecutive windows before they fire
— with a new `PENDING` state for alarms on their way there — and dashboard tiles
can overlay markers showing exactly when an alert fired and recovered. The trace
waterfall and the event side panel have both been redesigned: per-service span
colours and a minimap on one side, a single breadcrumb-navigated drawer instead
of a stack of layered panels on the other. External API v2 also grew full CRUD
for saved searches, webhooks, and sources, plus pagination on its list endpoints
— read the breaking changes below before upgrading a client that consumes those
lists.

### 💥 Breaking Changes

- **External API v2 list endpoints are now paginated and capped**:
  `/api/v2/alerts`, `/api/v2/saved-searches`, and `/api/v2/webhooks` accept
  `limit` (1–1000, default 1000) and `offset` (default 0), return a
  `meta: { total, limit, offset }` block alongside `data`, and sort by `_id` so
  paging is stable. Alerts and webhooks were previously unbounded, so a team
  with more than 1000 of either now sees only the first page unless the client
  reads the total and pages with `offset`. Every list response also sets an
  `X-Total-Count` header so truncation is detectable without parsing the body.
- **`DELETE /api/v2/alerts/:id` is no longer idempotent**: deleting an alert
  that does not exist now returns `404` instead of `200`, matching the
  documented contract. Alert `403`/`404` responses also return a JSON
  `{ message }` body instead of empty plaintext, and `PUT /api/v2/webhooks/:id`
  can now return `409` when the webhook's destination (`url`/`service`) was
  changed concurrently between read and write — re-read and retry.

### ✨ New Features

- **Consecutive-window alert conditions**: you can now require a condition to
  hold for N consecutive windows before an alert fires, which cuts out the flaky
  pages caused by a single noisy window. Alarms that will fire if the current
  trend continues report a new `PENDING` state, and the setting is configurable
  over the external API as well.
- **Event patterns as a first-class dashboard tile**: patterns can be created,
  edited, and saved as tiles with a dedicated "Pattern Expression" editor,
  supported across the UI, the MCP server, and External API v2.
- **Alert annotations on dashboard tiles**: enable "Show alert annotations" from
  the dashboard menu and every tile that has an alert draws a red vertical
  marker at the moment the alert fired and a green one when it recovered, so you
  can correlate alert events with the chart in one view. Labels float in
  reserved headroom above the marker line to stay clear of dense series and
  stacked bars. The overlay is off by default and its state lives in the URL
  (`?alertAnnotations=true`) rather than on the saved dashboard, backed by a new
  team-scoped `GET /api/alerts/:id/history` endpoint that returns only the state
  transitions inside the window you are viewing.
- **Redesigned event side panel**: logs, traces, and sessions now open in a
  single right-hand drawer with breadcrumb-stack navigation. Surrounding-context
  drilldowns, log → trace (via a new "View Trace" action), and session → event
  all navigate in place instead of stacking layered drawers.
- **Redesigned trace waterfall**: per-service span colours, a vertical service
  colour bar, child counts, durations rendered outside the bar with the span
  body on hover, and expand/collapse depth controls.
- **Trace minimap**: a minimap above the waterfall keeps the shape of the whole
  trace visible while you work inside part of it (#2552).
- **More control over bar and pie charts**: a new categorical bar chart display
  type, a custom ORDER BY input, and a configurable limit on the number of
  series.
- **Webhook retries with exponential backoff**: alert webhook deliveries are now
  retried rather than dropped when the receiving endpoint fails transiently.
- **Saved search, webhook, and source management over External API v2**: a new
  `/api/v2/saved-searches` router (list, get, create, update, delete —
  team-scoped, with `sourceId` ownership validation), full create/update/delete
  on `/api/v2/webhooks` (previously list-only), and create, read, update, and
  delete on the sources router, where granularity fields accept the same short
  format the API returns (e.g. `5m`, `15s`). Webhook `headers` and `queryParams`
  are write-only — accepted on create and update but never returned on read — so
  auth tokens do not leak, and pinned filters on saved searches are validated to
  confirm they will actually render as a sidebar facet rather than being stored
  and never shown.
- **Dashboard validation endpoint**: `POST /api/v2/dashboards/validate` lets you
  check a dashboard payload against the external v2 API before you save it.

### 🧪 Experimental

- **Opt-in Datadog receiver**: set `ENABLE_DATADOG_RECEIVER` and a Datadog Agent
  can ship traces, metrics, and logs to HyperDX. The contrib `datadogreceiver`
  is compiled into the collector binary and, when enabled, the OpAMP controller
  attaches it on `0.0.0.0:8126` to the traces, metrics, and logs pipelines. When
  collector authentication is enforced, the receiver validates the `DD-API-KEY`
  header against your team API keys (#2573).

### 🔧 Improvements

- **Service map can be coloured by latency, error rate, or throughput**: a new
  metric-mode toggle recolours the graph by the dimension you pick, with a
  legend explaining the sequential colour ramp and the fact that node size
  encodes throughput. The canvas and its controls now follow the app's
  light/dark colour scheme instead of being locked to dark, and the node popover
  is a raised surface with a service-name header, grouped sections, and
  severity-aware error colouring.
- **Leaner metrics schema**: the collector's metrics schema uses a more
  efficient primary key and better time pruning, so metric queries scan less
  data (#2545).
- **Dashboard tile polish**: surface-coloured tile cards with a border on a
  subtly muted page background, a modern dotted resize handle, and a compact,
  consistent header strip with a full-bleed separator. Tile actions are
  consolidated into a right-aligned kebab menu (with the alert bell) that sits
  after each chart's own controls.
- **Type arbitrary values into filter pills**: the value picker on an active
  filter pill now accepts free text, committed on Enter or blur, in addition to
  the suggested values — so you can filter on values that are not present in the
  sampled data.
- **Reset zoom on time-series charts**: a new button undoes a brush-zoom back to
  the pre-zoom time range.
- **MCP dashboard and source tools caught up with the UI**:
  `clickstack_save_dashboard` and `clickstack_patch_dashboard` accept an
  optional `backgroundChart` trend sparkline on builder number tiles (line or
  area, with an optional palette colour token; raw SQL number tiles do not
  support it), `clickstack_list_sources` and `clickstack_describe_source` return
  each source's Section label so agents see the same grouping as the source
  selector, and the tools now guide agents towards sensible tile sizes.
- **MCP tool errors are classified as user or server**: spans and the
  `hyperdx.mcp.tool.errors` counter carry an `error_category` attribute, so
  alerting rules can filter on `error_category=server` without noise from agent
  input mistakes. ClickHouse errors are classified automatically by inspecting
  the error type and walking the cause chain for TCP-level codes (#2570).
- **Richer API telemetry**: the OpAMP message-handler span is now a wide event
  carrying agent correlation and self-description context (instance UID,
  sequence number and gap, capability flags, service name and version, OS and
  host arch, health and last error, remote config apply status, config hash
  drift, request/response sizes, and more), and a new
  `hyperdx.opamp.remote_config_applications` counter tracks whether pushed
  configs actually applied. Client disconnects (`request.aborted` /
  `ECONNABORTED`) are now treated as operational, logged at debug and kept out
  of error tracking, and `hyperdx.api.errors` gains a bounded `error_type`
  dimension so aborts, oversized bodies, and malformed payloads are
  distinguishable.
- **Webhooks in use can no longer be deleted out from under alerts**: deleting a
  webhook that alerts still reference is blocked, with a prompt to reassign or
  remove those alerts first.

### 🐛 Bug Fixes

- **`INGESTION_API_KEY` is honoured in the all-in-one auth image**: the
  entrypoint reported an image name (`all-in-one`) that the config checks never
  matched, so the pre-shared ingestion key was silently ignored and the
  collector only accepted the team's UI-generated key. The auth and no-auth
  variants now report `all-in-one-auth` and `all-in-one-noauth`, letting demo
  and bootstrap stacks specify a known ingestion key up front.
- **Sources can be created and edited in Local App Mode**: saving a source
  returned HTTP 500 because the handler assumed a Mongoose `ObjectId` team id,
  where local mode injects a plain string.
- **"Add to Filters" works on values inside parsed JSON**: the
  `JSONExtractString(...)` expression the JSON viewer produces from a String
  column such as `Body` was mis-parsed as a dot-form Map sub-key and mangled
  into SQL that ClickHouse rejected (#2561).
- **Search filters no longer crash on empty attribute keys**: expanding a map
  attribute group such as `LogAttributes` that contained an empty key threw a
  Mantine "Accordion.Item component was rendered with invalid value" error and
  took out the panel. Those groups now render with an `(empty)` placeholder name
  (#2578).
- **Span bars keep their proportions when the waterfall is zoomed**: the minimum
  bar width was a percentage of the events area, which the zoom model widens, so
  very short spans grew as wide as multi-second ones. The floor is now a fixed
  pixel width, and sub-pixel spans remain clickable.
- **Table chart wrap mode**: long URLs and IDs break within their own column
  instead of overflowing into adjacent ones.
- **Dashboard tile titles no longer clip unpredictably**: titles use multi-line
  ellipsis truncation when a tile is resized small.
- **Time picker stays in sync with the URL**: the relative/absolute toggle was
  only seeded at mount and never re-synced, so switching live intervals via the
  URL left the picker in a mode that no longer matched the URL state.
- **Unsaved-changes prompt covers display and heatmap settings**: changing them
  and closing the tile editor now warns you instead of silently discarding the
  change.
- **Duplicate heatmap groups**: duplicate groups in heatmap query results are
  skipped.
- **Deep-linked sources scroll into view** on the team settings page.
- **Sessions source validation restored** after being inadvertently removed
  (#2568).
- **Primary button hover text colour applies again**: the theme set a
  non-existent Mantine variable, so hover text could fall through to an
  inherited page colour.
- **Left nav feedback control is hidden when the nav is collapsed**, where the
  thumbs up/down icons were not usable (#2566).

## v2.29.0 — 2026-06-30

<!-- hyperdx-release-notes version=2.29.0 inputs=backfill -->

This release is dominated by a major upgrade to the MCP server: every tool has
been renamed from `hyperdx_*` to `clickstack_*`, metrics are now a first-class
source with two new discovery tools, and agents can search dashboards, read a
single tile, and patch a dashboard without resubmitting the whole thing.
Dashboards got both faster and richer — tiles only query once they scroll into
view, and number tiles gained a background trend sparkline, ratio series, and
conditional colours. Elsewhere, data sources can be organised into sections, the
Service Map gained server-side filtering and latency percentiles, and there's a
new Browser RUM dashboard template. Read the breaking changes below before
upgrading: the MCP tool rename, a new unique index on user access keys, and a
change to how metric series are grouped all need attention.

### 💥 Breaking Changes

- **All MCP tools renamed from `hyperdx_*` to `clickstack_*`**: the MCP server
  itself is now named `clickstack`, and all 19 tools follow suit
  (`hyperdx_search` → `clickstack_search`, and so on). Any agent config, prompt,
  or automation that names tools explicitly needs updating (#2396).
- **Unique index added on user access keys**: API key authentication no longer
  does a full collection scan, but the new unique MongoDB index on
  `User.accessKey` will fail at startup if any existing users share a duplicate
  access key. Check for duplicates before upgrading (#2397).
- **Metric series grouping now distinguishes attribute scope**: Sum, Gauge and
  Histogram queries compute the attributes hash as
  `cityHash64(ScopeAttributes, ResourceAttributes, Attributes)` for both Map and
  JSON schemas. Two rows carrying the same logical key in different scopes (for
  example `host` on resource attributes for one emission and on span attributes
  for the next) now land in separate series instead of being collapsed into one.
  This only bites if a collector processor promotes attributes across scopes
  mid-stream.
- **Chart palette tokens renamed to hue names**: `chart-1` … `chart-10` are now
  `chart-blue`, `chart-orange` and so on, with the categorical palette unified
  across HyperDX and ClickStack. Existing dashboards are migrated automatically
  on read, write, import and render, so no action is needed for most users. One
  caveat: ClickStack dashboards saved with `chart-1` will flip from blue to
  green, because the migration uses HyperDX slot ordering — re-pick the hue from
  the (now hue-labelled) colour picker if that matters (#2362).
- **MCP dashboard tile names must be non-empty**: `clickstack_save_dashboard`
  now rejects `name: ""` with a validation error rather than silently persisting
  a blank title (#2343).

### ✨ New Features

- **First-class metric support in the MCP server**: two new tools —
  `clickstack_list_metrics` paginates the metric-name catalogue with kind,
  name-pattern and time-window filters, and `clickstack_describe_metric` returns
  a metric's kind, unit, description, attribute keys and sampled values.
  `clickstack_describe_source` is now metric-aware, and `clickstack_timeseries`
  / `clickstack_table` accept `metricType`, `metricName` and `isDelta` per
  select item plus `aggFn: "increase"` for counters. The old "use raw SQL for
  metric tiles" workaround is gone, replaced with a real discovery workflow.
  Summary and exponential histogram kinds are still out of scope.
- **MCP dashboard tools for granular edits**: `clickstack_get_dashboard_tile`,
  `clickstack_patch_dashboard` and `clickstack_search_dashboards` let an agent
  find a dashboard by name or tag, read one tile, and replace it without
  resubmitting the full dashboard (#2343).
- **One-click AI assistant setup**: a new "Connect your AI assistant" section on
  Team Settings → Integrations generates ready-to-paste MCP install snippets for
  Claude Code, Cursor, VS Code + Copilot, Codex CLI, or any MCP host — each
  carrying your personal access key, no hand-rolled JSON required (#2407).
- **Browser RUM dashboard template**: a new gallery template for browser
  sessions instrumented with the HyperDX Browser SDK (or any OTel browser
  instrumentation emitting `rum.sessionId`). Covers page-view/session/error
  KPIs, Core Web Vitals p75, page-load percentiles, traffic broken down by URL,
  browser, country and device size, and an errors section for JS exceptions and
  failing API calls. Enable the collector's `geoip` processor to populate the
  country tiles (#2413).
- **Richer number tiles**: number tiles can render a faint line or area
  sparkline behind the value showing its trend over the selected range (handy
  for SLO burn), support a second series via an "As Ratio" toggle for rendering
  rates as a single big number, and accept static colours plus ordered
  conditional colour rules. Colour, colour rules and the background chart are
  all authorable through the v2 REST dashboards API and the MCP dashboard tools
  as well as the in-product editor (#2428).
- **Row-click actions on dashboard table tiles**: table tiles can be configured
  with an external link opened by clicking a row. Actionable rows highlight on
  hover and reveal a trailing arrow icon with a tooltip naming the destination,
  and the icon supports all the usual browser behaviours (cmd-click,
  middle-click, right-click) (#2380).
- **Sections for data sources**: sources can carry an optional free-text Section
  label, set from the source settings form and returned by
  `GET /api/v2/sources`. The source selector groups by section and matches
  searches against the section name, so typing "billing" surfaces every source
  in the Billing section regardless of its name; the field autocompletes from
  sections already in use, and Manage Sources shows each source's section.
  Deployments that haven't adopted sections see no change (#2432, #2477, #2476).
- **Service Map: filtering, percentiles and focus**: the map now supports
  server-side Lucene/SQL filtering and a service multi-select with
  inbound/outbound neighbour expansion, shows p50/p95/p99 latency and throughput
  in node and edge tooltips, sizes nodes by total throughput, and offers a
  "Focus" action to scope the map to a service and its immediate dependencies
  (#2387).
- **Inline split detail in the trace panel**: inspect a span alongside the trace
  rather than losing your place (#2402).
- **Connections and team management in the external API**: `/api/v2/connections`
  supports list, get, create, update and delete with Bearer token authentication
  (passwords are write-only and never returned), and there's a new v2 endpoint
  for team management (#2452).
- **Editable filter pills**: clicking an active filter pill under the search bar
  opens a menu to copy the value, flip the filter between include and exclude,
  or switch to a different value of the same field — all without removing and
  re-adding the filter (#2455).
- **Choose the event pattern grouping column**: pick the column or SQL
  expression used to group event patterns, with the choice captured in a
  shareable URL (#2460).
- **Duplicate a series in the chart builder**: copy a series row in place to
  build a near-identical variant (avg and p95 of the same column, say) without
  re-entering every field (#2453).
- **Known Columns List setting for distributed tables**: declare the known
  columns for a distributed table on the source.
- **Fit the y-axis lower bound on time charts**: an option to scale the y-axis
  to the data instead of anchoring at zero (#2417).

### 🧪 Experimental

- **PromQL against an external Prometheus-compatible endpoint**: a connection
  can now be configured as a Prometheus endpoint from the UI, with a polish pass
  across the PromQL experience in the app. This path is gated on configuration —
  the standalone collector only declares the `prometheusremotewrite` exporter
  and `metrics/promql` pipeline when `CLICKHOUSE_PROMETHEUS_METRICS_ENDPOINT` is
  set, and the OpAMP-managed config only adds the exporter when PromQL is
  enabled. If you had the endpoint unset, the collector no longer emits failing
  remote-write attempts on every metrics batch (#2468).

### 🔧 Improvements

- **Dashboards load far fewer queries**: tiles now run their ClickHouse queries
  the first time they scroll into the viewport rather than all firing on page
  load, and keep their data afterwards. Large dashboards open dramatically
  faster (#2454).
- **Per-chart time series limits**: the top-N series cap for group-by time
  charts moved from a workspace-wide team setting to a per-chart control in the
  Display Settings drawer. It's disabled by default, only appears for builder
  line and bar charts, and its Generated SQL preview comes from the chart's own
  config. When a limit is set, chunked queries now pin the ranking to the newest
  chunk window, so adjacent time windows agree on the series set and the chart
  never renders more series than the limit (#2429, #2449).
- **More reliable MCP query execution**: ClickHouse safety settings now use
  `readonly=2` so `max_execution_time` is actually applied, the over-eager
  `max_result_rows` cap was removed (it tripped `SETTING_CONSTRAINT_VIOLATION`
  on constrained connections), and error hints now cover unknown identifiers,
  DateTime64 casts and constrained settings with actionable guidance.
  `describe_source` uses rollup tables for map-key discovery so it times out far
  less often, multi-word aliases are quoted correctly in `orderBy`, and
  `clickstack_search` gained a `denoise` option mirroring the web app's "Denoise
  Results" (#2427, #2439, #2433, #2426, #2451, #2418, #2371).
- **Number tiles fit their container**: the value auto-scales its font to the
  available width, so it no longer overflows narrow tiles or wastes space on
  wide ones, and an error boundary keeps one broken tile from taking down the
  dashboard (#2373).
- **Easier to trace a line in a busy chart**: the series nearest the cursor is
  thickened while the others fade back, and its tooltip row is bolded while the
  rest dim.
- **Alert templates get group-by context**: `{{attributes.*}}` template
  variables are now populated for tile and chart alerts from their group-by
  fields (#2466).
- **Faster source setup**: creating a Metrics source auto-fills the five
  metric-table dropdowns by matching table names in the selected database
  (preferring `otel_metrics_` prefixed names, never overwriting your choices),
  and the source picker gained a chip and kebab-menu layout. Search now suggests
  fields from the source (#2365, #2436).
- **Dashboard page uses the shared layout**: breadcrumbs, editable name, actions
  and metadata now live in one page header, with the query toolbar (WHERE, time
  range, granularity, Live, refresh, Run) pinned as the only sticky row so the
  chrome above scrolls away (#2364).
- **Run raw SQL chart queries with Cmd/Ctrl+Enter** from the SQL editor (#2458).
- **Optimistic favourites** — starring a dashboard or saved search updates
  immediately instead of waiting on the server (#2443).
- **Timeline view shows elapsed time and Generated SQL**, matching the other
  search views.
- **Password complexity is enforced on team invite acceptance**, not just at
  registration.
- **Deeper operational telemetry**: the API now emits standard availability and
  latency SLIs (`hyperdx.operation.requests`, `hyperdx.operation.duration_ms`,
  labelled by operation and outcome) for AI assistant generation, the ClickHouse
  proxy, and alert evaluation and its data fetch, plus new metrics and tracing
  for OpAMP message handling, the Prometheus proxy, alert notification delivery
  and MongoDB connection lifecycle. Traces across every auth path now carry
  consistent team, user and feature-flag context.

### 🐛 Bug Fixes

- **Expanding a row no longer crashes on numeric-looking map keys**: paths under
  a `Map(String, String)` column were rendered as array subscripts
  (`LogAttributes[2]`), which ClickHouse rejects. Map sub-keys now always render
  as string subscripts (#2357).
- **Filtering on timestamps and awkward column names works**: date column values
  in IN/NOT IN filters are wrapped in a type-matching parse expression, so
  including or excluding a timestamp no longer fails with "Cannot convert string
  … to type DateTime64", including for aliased and computed date columns. Filter
  keys containing special characters are also handled correctly, as are boolean
  values in the JSON viewer's filter actions.
- **Event Patterns respects select aliases**: filtering on a column the source
  only exposes under an alias (for example `ServiceName as service`) no longer
  fails with "Unknown expression or table expression identifier" (#2467).
- **Drawers stack correctly again**: the sticky page header no longer floats
  above drawer overlays, and clicking a row in a fullscreen search tile now
  opens its side panel above the modal instead of behind it (#2394).
- **Markdown dashboard tiles**: tiles with a minimal config (no resolved source)
  can be saved again, and they no longer break dashboard imports.
- **Number tile display settings behave**: opening Display Settings on a tile
  whose format is auto-detected from the datasource and clicking Apply no longer
  rewrites it to plain Number, and the background sparkline now drops `groupBy`
  so its trend matches the single aggregate value it sits behind.
- **Search filter UI fixes**: nested filter dropdowns no longer disappear when
  reopened, and excluded ("!=") pills use a soft red tint that's readable in the
  light theme (#2421, #2478).
- **Source form dropdowns are usable**: the database, table and connection
  dropdowns in the source setup modal render in a portal so the full list is
  visible and scrollable, and the source select right-hand menu has a sane
  height (#2411, #2419).
- **Parametric aggregate function arguments are inlined** rather than passed as
  query parameters, which ClickHouse rejects (#2474).
- **Runtime environment variable injection works in published images** again
  (#2322).
- **Assorted fixes**: deleting a dashboard now returns you to the dashboard list
  (#2444), log detail Timestamp fields render in your local timezone rather than
  raw UTC, table content no longer overlaps sticky headers, chart error states
  are consistent across chart types (#2404), and nested subdocuments such as
  `metadataMVs` can be deleted again.

### 📦 Build / Packaging

- **OTel Collector base bumped to v0.155.0**: two hops from contrib v0.149.0
  (core 1.55.0) up through v0.154.0 to v0.155.0 (core 1.61.0). No config changes
  are required — upstream breaking changes across those versions were reviewed
  against every component HyperDX ships and are all backward-compatible aliases,
  explicit-config no-ops, or in unused components.
- **`http-proxy-middleware` upgraded to v4**, replacing the unmaintained
  `http-proxy` with `httpxy`.
