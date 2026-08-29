# HyperDX Changelog

Release-level highlights across all HyperDX packages. Each entry is AI-generated
during the release and reviewed (and freely editable) in the "Release HyperDX"
PR — keep the `hyperdx-release-notes` comment marker intact when editing so your
edits survive regeneration. Per-package detail lives in each
`packages/*/CHANGELOG.md`.

## v2.37.0 — 2026-08-28

<!-- hyperdx-release-notes version=2.37.0 inputs=27e3ad215675 -->

**Metrics explorer and in-app release notes**

You no longer have to know a metric's name to chart it: the chart editor gains a
metrics explorer that browses your metric namespace as a tree, searches every
name and description the source reports, and shows a metric's kind, unit,
reporting services and tag values before you commit to it. The Help menu's
"What's new" is rebuilt around these release notes, so each release's highlights
are readable in the app itself. Multi-webhook alerts are now honoured end to
end — every configured channel is notified, every target is shown on the alerts
pages, and delivery time is attributed to the target it went to — and session
replays no longer break when a recording contains a very large event.

### ✨ New Features

- **Metrics explorer in the chart editor**: a browse control beside the metric
  select opens a modal with a prefix hierarchy over your metric namespace
  (`system` → `cpu` → `utilization`) plus search across every metric name and
  description. Each row shows the metric's kind and description, and the detail
  pane gives the unit, reporting services and tag keys you can drill into,
  replacing a flat dropdown of thousands of names that only revealed that
  metadata after you had chosen. Names split on `.` when they have one and on
  `_` otherwise, decided per metric, so dotted OpenTelemetry names and
  underscore-style exporter names both nest sensibly. While browsing a metric's
  tags you can stage filters and group-bys as removable chips and apply them
  with the metric, and applying sets an aggregation suited to the kind — average
  for a gauge, sum for a counter, p95 for a histogram (#3000, thanks
  @MikeShi42!).
- **"What's new" lives in the app**: the Help menu's full-changelog modal is
  replaced by an inline section, a "View all releases" drawer, and a sparkle on
  the Help icon when the running version has not been acknowledged in this
  browser. Everything comes from the release notes themselves — headline and
  summary lead each release, breaking changes and new features are listed and
  badged apart, and the remaining sections are summarised as counts. The
  changelog is parsed at build time rather than shipped as a fetched asset
  (#2993, thanks @jordan-simonovski!).
- **Alerts that carry their own chart, without a saved search or dashboard
  tile**: a new `inline` alert source persists a chart config directly on the
  alert, so alerting on a query no longer means saving a search or building a
  tile first. Builder configs on log, trace and metric sources are supported
  alongside raw SQL on Line, Stacked Bar and Number displays (PromQL is
  rejected), inline alerts evaluate through the same path as tile alerts —
  group-by and multi-window behaviour included — and their notifications link
  to the chart explorer seeded with the alert's own config over the alerting
  window. This release lands the backend only; the creation and edit UI and
  external API v2 support follow separately (#3010).
- **Span links read both ways in the span detail**: the Overview panel now shows
  reverse span links — the spans that link to the one you are looking at — as
  well as the links the span declares itself, and resolves each link's details
  instead of leaving you with bare ids (#3011, thanks @karl-power!).
- **Dashboard variables are available to everyone**: the feature toggle that
  gated dashboard variables is gone, so every deployment gets variables — and
  the filter, Lucene and PromQL work below — without turning a flag on first
  (#3009, thanks @pulpdrew!).
- **Dashboard filter values persist per variable**: filter value state is now
  stored keyed by its variable, so a dashboard keeps the selections you made
  (#2963, thanks @pulpdrew!).
- **Exact-match Lucene variable references are distributed**: a Lucene search
  that matches a field exactly against a dashboard variable now expands across
  the variable's values (#2987, thanks @pulpdrew!).
- **Dashboard variables work in PromQL charts**: a PromQL query on a dashboard
  tile now has its variable references substituted before it runs, so PromQL
  charts respond to the dashboard's variables like the rest of your tiles, and
  the PromQL editor completes the variables available to it as you type. A
  variable used somewhere PromQL cannot take one is now called out with a
  warning instead of leaving you to work out why the chart is empty, and a
  preview shows the generated PromQL the chart will run (#2994, #2995, #2997,
  #2998, thanks @pulpdrew!).
- **Dashboard variables over the MCP server**: the MCP server now supports
  dashboard variables, so a dashboard an agent reads or writes keeps the
  variables it is built on (#2951, thanks @pulpdrew!).

### 🔧 Improvements

- **Notification duration is attributed to each target**: the figure was a
  single number covering the whole delivery, and because an alert's targets are
  notified concurrently the slowest one set it — so a multi-target alert gave
  you a number with no way to tell which webhook was responsible, or that the
  others were fine. Each dispatch is now timed on its own and aggregated per
  target across the evaluation, so the evaluation history's "Notification
  duration" cell expands in place to show each target's name, its summed
  duration, how many dispatches it took and how many of them failed. Evaluations
  recorded before this release keep showing their total with nothing to expand
  (#3003, thanks @jordan-simonovski!).
- **Alert actions are the same on both alerts surfaces, and an alert's source
  is legible**: the alerts page row menu now opens the alert editor directly, so
  changing a threshold no longer means navigating to the alert first, and a new
  filter narrows the list by what an alert watches — free-text search matches it
  too, so typing "tile" works without touching the dropdown. Each row's source
  icon gains a tooltip and accessible label naming it ("Saved search" /
  "Dashboard tile"). On the alert detail page, Edit, Delete and Terraform export
  move behind the same overflow menu the list uses instead of spreading four
  buttons across the header, the link to what the alert watches becomes an icon
  beside the alert's name, and the properties block keeps the creator and the
  created and updated timestamps in a dimmed line beneath the alert's settings
  rather than competing with them. Team settings tabs gain icons (#3015, thanks
  @jordan-simonovski!).
- **Every alerts-page row has the same trailing controls**: the Terraform
  import, source link and acknowledgement actions were each conditional, so no
  two rows lined up. The conditional actions move into an overflow menu that
  always renders — with a new "Delete alert" item alongside them — and the
  acknowledgement button gets a reserved slot, so its absence no longer shifts
  the row (#3002, thanks @jordan-simonovski!).
- **The alerts page stays responsive with a long list of alerts**: the list is
  virtualised, so only the rows on screen are rendered and scrolling no longer
  slows down on a team with hundreds of alerts (#3012, thanks @pulpdrew!).
- **API keys and MCP install snippets stay masked until revealed**: both now
  hide their secret behind a shared reveal-to-copy control, so you can open
  those pages without the key on screen (#2988).
- **Closing the dashboard filter editor confirms first**: you are asked before
  unsaved changes to a dashboard filter are discarded, so a stray click no
  longer loses the edits you were part-way through (#3005, thanks @pulpdrew!).
- **Better metric discovery over MCP**: the MCP server's metric discovery is
  improved, so an agent working with your metrics finds the right one more
  reliably (#2861, thanks @karl-power!).

### 🐛 Bug Fixes

- **Alerts reliably notify their configured channels**: configured channels were
  encoded as `@webhook-<id>` mention strings and appended after whatever you
  wrote in the alert message, so a body containing enough mentions consumed the
  entire per-event notification cap and the alert's own channel — the one target
  it was set up to notify — was silently never reached. Configured channels are
  now built directly, queued first, and exempt from a cap that only ever meant
  to bound ad hoc mentions. Mentions in the message body are unchanged, still
  capped, and still deduplicated against the configured channels, so naming one
  twice notifies it once (#2984, thanks @jordan-simonovski!).
- **The alerts pages show every notification target**: rows and the alert detail
  header only rendered the legacy singular channel, so an alert notifying three
  webhooks read as if it notified one, labelled a generic "Webhook" rather than
  the webhook's name. The detail page now names each target with its service
  icon, keeping the first two inline and collapsing the rest into a `+N more`
  tooltip, while rows show the icons with names on hover. The evaluation
  history's "Webhook Duration" column is renamed "Notification duration" with a
  tooltip, since the figure was always the wall time of a delivery that fans out
  to every target at once (#3001, thanks @jordan-simonovski!).
- **Session replays survive very large recorded events**: an rrweb event over
  the recorder's ~950KB chunk size is split into chunks that all share one
  timestamp, and the replay query ordered by timestamp alone, so ClickHouse
  could return them scrambled and the event — often the full DOM snapshot with
  all its inlined CSS — was silently dropped, leaving replays empty, unstyled or
  frozen mid-session. The stream is now ordered deterministically, chunks are
  reassembled by explicit index, and any event that still cannot be rebuilt is
  flagged in the player instead of swallowed. Existing recordings play back
  correctly without re-ingestion (#2956).
- **Gemini-backed MCP clients can connect again**: the quantile `level` field
  was advertised as a numeric enum, and Gemini's function declarations accept
  `enum` only alongside `type: "string"` — so a client forwarding tool schemas
  to the provider had its whole tool list rejected over this one field, with a
  generic "trouble connecting to the model provider" error that named neither
  the tool nor the property. `level` is now advertised as a string enum on
  `clickstack_timeseries`, `clickstack_table`, `clickstack_save_dashboard` and
  `clickstack_patch_dashboard`; numeric input is still accepted and
  out-of-set values are still rejected, and the external REST API's own contract
  is untouched (#2971, thanks @RIP21!).
- **Drilling down to Search carries the variable's value, not its name**:
  dashboard variables are now expanded before a drill-down opens the search
  page, so the search runs against the values you were looking at instead of the
  unresolved variable references (#3008, thanks @pulpdrew!).
- **A failed release-marker query says so**: when the query behind release
  markers fails — for example because a source's version expression references a
  column such as `ResourceAttributes` that the table does not have — you now get
  a distinct "couldn't load release markers" notification, instead of an empty
  chart indistinguishable from "no releases in this time range" (#3007, thanks
  @teeohhem!).

### 📦 Build / Packaging

- **`@hyperdx/common-utils` ships usable type declarations**: internal `@/*`
  path aliases no longer leak into the published `.d.ts` files, where they could
  not be resolved by consumers (#2969, thanks @pulpdrew!).

<!-- hyperdx-package-list -->

### 📦 Package changelogs

- `@hyperdx/api` 2.36.0 → 2.37.0 — [changelog](https://github.com/hyperdxio/hyperdx/blob/main/packages/api/CHANGELOG.md#2370)
- `@hyperdx/app` 2.36.0 → 2.37.0 — [changelog](https://github.com/hyperdxio/hyperdx/blob/main/packages/app/CHANGELOG.md#2370)
- `@hyperdx/common-utils` 0.27.0 → 0.28.0 — [changelog](https://github.com/hyperdxio/hyperdx/blob/main/packages/common-utils/CHANGELOG.md#0280)
- `@hyperdx/hdx-eval` 0.3.2 → 0.3.3 — [changelog](https://github.com/hyperdxio/hyperdx/blob/main/packages/hdx-eval/CHANGELOG.md#033)
- `@hyperdx/otel-collector` 2.36.0 → 2.37.0 — [changelog](https://github.com/hyperdxio/hyperdx/blob/main/packages/otel-collector/CHANGELOG.md#2370)

<!-- /hyperdx-package-list -->

## v2.36.0 — 2026-08-21

<!-- hyperdx-release-notes version=2.36.0 inputs=f975367d849a -->

Formulas are the headline of this release: any metric, log or trace chart can
now carry a derived series written as letter-ref arithmetic over its own series
(`A / (A + B) * 100`), authored in the chart editor and readable and writable
over the external API, MCP and the CLI. Alerts gained two long-standing
requests — up to ten notification webhooks per alert, and an Edit/Delete action
on the alert details page — and your personal API access key can finally be
rotated instead of being fixed for the life of the account. Operators get
per-signal ClickHouse table TTLs with optional reconciliation of existing
tables, a configurable exporter timeout, and an API that retries a MongoDB it
cannot reach at startup, behind a new `/ready` probe. Note the API logging
default change below before upgrading if you read query SQL out of your API
logs.

### 💥 Breaking Changes

- **The API's log level now defaults to `info`, and query SQL is no longer
  dumped to the console**: `BaseClickhouseClient` printed raw SQL on every
  ClickHouse query, unconditionally and outside the pino logger, flooding API
  logs with query spam. Query logging now goes through the pino logger at
  `debug`, and the API's default log level moves from `debug` to `info` — so
  set `HYPERDX_LOG_LEVEL=debug` if you relied on seeing query SQL or other
  debug output in production. Dev and CI env files pin their levels explicitly
  and are unaffected. An empty `HYPERDX_LOG_LEVEL` — what Compose passes when
  the variable is unset — now falls back to the default instead of making pino
  throw at startup. In the browser, query SQL still goes to devtools,
  pretty-printed as a readable multi-line block (#2679).

### ✨ New Features

- **Formulas on metric, log and trace charts**: time series, table and number
  charts gain an "Add Formula" row where you write a letter-ref arithmetic
  expression over the chart's series (`A` = series 1, `B` = series 2), with
  inline validation of malformed expressions and unknown references, a
  per-formula alias and number format, series letter badges, and a "Show input
  series" toggle to render the formula on its own or alongside its operands.
  Formulas and the "As Ratio" toggle are mutually exclusive, a missing operand
  counts as 0 while a zero or missing denominator renders a gap, and number
  tiles always show the formula rather than the first raw operand. Event-source
  formulas compile inline into the chart's single-scan SELECT, so there's no
  per-series query fan-out, and formulas persist on dashboard tiles and
  standalone charts (#2909, #2908, #2953).
- **Formulas over the external API, MCP and CLI**: external dashboards API v2
  and the MCP `save_dashboard` / `patch_dashboard` tools accept `formulas` and
  `showOperandSeries` on line, stacked bar, table and number builder tiles and
  round-trip them through GET/PUT. Expressions are validated on write — unknown
  series refs, malformed syntax, formulas combined with `asRatio`, several
  formulas on a number tile, and formulas on source kinds that can't carry them
  are all rejected with actionable errors. `query_tile` computes formula
  columns for metric and event tiles, the query-guide prompt documents the
  feature, and CLI-rendered tiles now hide operands exactly as the web does
  (#2952).
- **Alerts can notify up to 10 webhooks**: alert forms for saved searches and
  dashboard tiles let you add and remove notification channels inline, with
  webhooks the alert already uses greyed out in the other pickers since
  duplicates are rejected. The new `channels` field is available on the v2
  external API, the internal API and the MCP `clickstack_save_alert` tool, and
  the singular `channel` field still works unchanged. One caveat for API
  clients: an alert update is a full replace, not a merge, so fetch the alert
  and resend the complete `channels` array — an update carrying only `channel`
  reduces a multi-channel alert to that one webhook (#2846, #2848, #2845).
- **Edit and delete an alert from its details page**: an "Edit alert" action
  opens a modal for the alert's threshold, evaluation interval, schedule,
  group-by (saved-search alerts), notification webhook and note, and a Delete
  action removes the alert after confirmation and returns you to the alerts
  list. Alert API responses now include the notification channel's webhook id
  and the alert's name and message template, so edits round-trip those fields
  (#2931).
- **Rotate your personal API access key**: Team Settings → API & Agents gains a
  Rotate action for the personal access key — the bearer token behind external
  API v2 and the MCP server — which until now was generated once at account
  creation and could only be changed by deleting the user. Rotating revokes the
  previous key immediately, so update your MCP and AI agent configs, API
  clients, Terraform providers and CI scripts with the new one. Browser
  sessions are unaffected (#2926).
- **Per-signal ClickHouse table TTLs**: `HYPERDX_OTEL_EXPORTER_LOGS_TTL`,
  `..._TRACES_TTL`, `..._METRICS_TTL` and `..._SESSIONS_TTL` each fall back to
  the existing `HYPERDX_OTEL_EXPORTER_TABLES_TTL`, so you can keep logs and
  traces for six months while metrics age out at 30 days. Set
  `HYPERDX_OTEL_EXPORTER_RECONCILE_TABLE_TTL=true` and the migrate tool also
  applies the configured retention to tables that already exist, where
  previously a TTL change only reached newly-created tables. Reconciliation is
  off by default and deliberately conservative: extending a retention keeps
  data already on disk, shrinking one never triggers a bulk delete at startup,
  and compound policies (tiering, `RECOMPRESS`, `GROUP BY` rollups) and
  calendar-unit retentions are reported and left untouched (#2709).
- **The API survives a MongoDB that is unreachable at startup, and serves a
  readiness probe**: a failed initial connect was never retried, so the process
  kept listening while every Mongo-backed request timed out — `/health` still
  answered 200, Kubernetes kept the pod Ready indefinitely, and the resulting
  OpAMP 500s crash-looped collectors. The initial connection is now retried
  with capped exponential backoff until it succeeds, and both the API and OpAMP
  servers expose `GET /ready`, which returns 503 unless MongoDB is connected.
  Point your Kubernetes readiness probes at it; `/health` remains a pure
  liveness check (#2968).
- **Dashboard variables reach chart builder tiles**: variables are now
  substituted into builder tiles as well as raw SQL, a variable's value query
  can depend on other variables, and variables and macros nested inside macro
  arguments are expanded (#2901, #2923, #2937).
- **Dashboard variables over the external API**: dashboard variable properties
  are now carried by the external dashboards API, so a dashboard managed as
  code keeps its variables (#2944).

### 🔧 Improvements

- **"Convert to SQL" handles multi-series, ratio and formula metric charts**:
  the composed UNION ALL and pivot query is emitted as a macro-based raw-SQL
  template with a `$__sourceTable(<metricType>)` macro per series branch,
  instead of answering "cannot be auto-converted". Non-time-series metric
  charts remain unsupported, as before (#2908).
- **The ClickHouse exporter timeout is configurable**: set
  `HYPERDX_OTEL_EXPORTER_TIMEOUT` in either OpAMP-managed or standalone
  collector mode. The default is still 5 seconds (#2899).
- **Map attribute searches use ClickHouse's direct-read path more often**: the
  Map KV text-index rewrite now also applies to SQL predicates in the top-level
  `where` — the search box, saved searches and alerts — and to SQL
  `aggCondition`s copied into the WHERE clause, where previously only
  `sql`-type filter entries were rewritten (#2948).
- **Failed MCP tool calls show their error in the trace**: the span's
  `StatusMessage` is now populated, so you can read why a tool call failed
  without correlating logs (#2934).
- **Interface polish**: standalone charts now use the same bordered card
  treatment as dashboard tiles, with a header that stays pinned while a long
  list like "Top 20 Most Time Consuming Queries" scrolls underneath (Service
  Dashboards and the ClickHouse page are migrated); histogram charts, including
  Request Latency on the Services dashboard, use the categorical palette and
  shared tooltip instead of a hardcoded neon green fill; and JSON viewer keys
  are sorted alphabetically so wide Map columns are scannable (#2829, #2949,
  #2943).

### 🐛 Bug Fixes

- **Filter sidebar values no longer disappear behind a query proxy**: batched
  facet-value queries bound one query parameter per key, and with around 100
  keys that exceeded the ClickHouse web client's URL parameter budget, silently
  promoting the request to a multipart body that proxy gateways reject — every
  LowCardinality-column and map-attribute filter then vanished with no error.
  Keys are now inlined as escaped literals so the query rides the POST body
  with a constant parameter count. Also fixes an operator-precedence bug that
  applied the KV rollup time filter to only the last OR branch (#2932).
- **Dashboard filter selections survive complex expressions**: the filter
  parser shared with the search page now tracks parenthesis depth as well as
  quote depth, so a selection stored against an expression-based filter such as
  `if(SeverityText IN ('error', 'fatal'), 'Errors', 'Non-errors')` is parsed
  correctly instead of being dropped or split on a keyword nested inside the
  expression (#2950).
- **Multi-series metric charts can mix float and integer aggregations**: a
  chart combining, say, a histogram quantile with a histogram count failed with
  "No value columns found in result column metadata". Every series value is now
  normalised to Float64 so the merged column type is deterministic, rather than
  erroring with NO_COMMON_TYPE or producing a Variant column depending on the
  server's `use_variant_as_common_type` setting. All-numeric `Variant(...)`
  columns from raw-SQL charts are also classified as numeric now (#2916).
- **HAVING, ORDER BY and LIMIT apply to the whole multi-series chart**: they
  were leaking into each per-series branch, so an ORDER BY was applied per
  branch and then discarded by the join. They now reference the chart's output
  columns — operand aliases, formula names, the ratio column, group-by columns
  and the time bucket — so a HAVING like `"err rate" > 0.5` filters the joined
  rows and LIMIT/OFFSET paginate one consistent group set across every series
  (#2946).
- **MCP tool schemas validate against JSON Schema draft 2020-12**: the
  number-tile `colorRules` `between` rule declared its value as a tuple, which
  serialises to the draft-07 form, so `clickstack_save_dashboard` and
  `clickstack_patch_dashboard` failed validation — and clients that forward
  tool schemas straight to an LLM provider rejected the entire tool list,
  making the MCP server unusable. The wire format is unchanged, and a new test
  validates every tool's schema against the 2020-12 metaschema (#2925).
- **Alert markers line up with the data they were evaluated against**: firing
  and recovery markers are drawn at the start of the newest evaluated bucket,
  matching the evaluation history table and the plotted point, instead of at
  the evaluation time one bucket to the right (#2928).
- **Tile alerts on formula charts evaluate the formula**: the alert task
  dropped `formulas` and `showOperandSeries` when rebuilding the tile's chart
  config, so the threshold was compared against a raw operand (bytes, say)
  rather than the derived value. Grouped ratio tile alerts also honour
  `ratioMode` now, where `share_of_total` previously evaluated as `per_group`
  (#2909).
- **Surrounding Context filters work on non-OTel schemas**: the "Service"
  filter uses the source's `serviceNameExpression` instead of a hardcoded
  ResourceAttributes lookup, and quick event attribute filters let you toggle
  attributes from the current event to narrow the surrounding results (#2558).
- **The external dashboards API stops returning unusable aggregation
  parameters**: a `level` left over from a quantile aggregation, or a
  `valueExpression` left on a count, were ignored when rendering but rejected
  by the input schema — so a GET body could not be PUT back, and importing a
  dashboard into Terraform failed with "Level can only be used with quantile
  aggregation function" (#2945).
- **The check-alerts worker no longer hits `MongoExpiredSessionError`**:
  mongoose `autoIndex` is disabled in the worker (#2887).

### 📦 Build / Packaging

- **Session replay player upgraded to rrweb 2.1.1**: the replayer moves off
  `2.0.0-alpha.8` onto the stable release used by current `@hyperdx/browser`
  recorders, picking up several years of upstream fixes to style-sheet
  handling, the virtual DOM and adopted stylesheets. Replay fidelity was
  verified against sessions recorded with both older (`rrweb@1.1.3`) and
  current SDKs, so existing recordings keep playing back (#2954).

<!-- hyperdx-package-list -->

### 📦 Package changelogs

- `@hyperdx/api` 2.35.0 → 2.36.0 — [changelog](https://github.com/hyperdxio/hyperdx/blob/main/packages/api/CHANGELOG.md#2360)
- `@hyperdx/app` 2.35.0 → 2.36.0 — [changelog](https://github.com/hyperdxio/hyperdx/blob/main/packages/app/CHANGELOG.md#2360)
- `@hyperdx/cli` 0.6.1 → 0.6.2 — [changelog](https://github.com/hyperdxio/hyperdx/blob/main/packages/cli/CHANGELOG.md#062)
- `@hyperdx/common-utils` 0.26.0 → 0.27.0 — [changelog](https://github.com/hyperdxio/hyperdx/blob/main/packages/common-utils/CHANGELOG.md#0270)
- `@hyperdx/otel-collector` 2.35.0 → 2.36.0 — [changelog](https://github.com/hyperdxio/hyperdx/blob/main/packages/otel-collector/CHANGELOG.md#2360)

<!-- /hyperdx-package-list -->

## v2.35.0 — 2026-08-14

<!-- hyperdx-release-notes version=2.35.0 inputs=e0e56c56149f -->

The headline of this release is OIDC authentication for OTLP ingestion: the
standalone collector can now validate incoming OTLP requests against your
identity provider instead of a single long-lived shared secret. Alerts also gain
a per-window evaluation history you can read over the API, broken down by group
and surfacing the errors from windows that failed to evaluate, with an in-app
alert detail page available behind a feature flag. Dashboard filters pick up
variable and broadcast settings, dashboard variables now resolve inside raw SQL
tiles and the SQL editor autocompletes and validates them, and sources can now
name the expression that identifies a service's running release — which
dashboard tile charts can overlay as release markers. Terraform export changes
shape as well — import ids are now team-scoped and the provider floor has moved,
so read the breaking change below before you re-run an export.

### 💥 Breaking Changes

- **Terraform export emits team-scoped import ids**: exported resources now use
  `<team_id>/<resource_id>` as their import id, so you can import from a
  ClickStack deployment that backs more than one team. Each imported resource
  gains a `team` attribute, which the provider marks as forcing replacement —
  the generated file now tells you to keep it. The provider floor moves to
  `>= 3.25.0`, so raise your provider constraint and re-export before importing;
  an import file generated by an earlier release carries the old bare ids. In
  return, 3.25.0 drops server-only dashboard ids on import, so a generated
  dashboard config no longer churns tile ids — and the tile alerts attached to
  them — on every apply (#2898).

### ✨ New Features

- **Alert evaluation history over the API**: a new
  `GET /alerts/:id/evaluations` endpoint returns an alert's per-window
  evaluation history for a time range, clamped to the retention window, with a
  per-group breakdown for group-by alerts, evaluation analytics fields, and
  deduped errors for windows that ended in an ERROR state. Results are
  cursor-paginated and the cursor always advances, so paging through a history
  with gaps in it terminates (#2833).
- **OIDC bearer token authentication for the OTLP receiver**: the standalone
  collector can now authenticate OTLP requests against an OIDC provider's
  published JWKS rather than the static `OTLP_AUTH_TOKEN`. Set `OIDC_ISSUER_URL`
  and `OIDC_AUDIENCE` to validate incoming telemetry against short-lived tokens
  issued by your provider instead of distributing one shared secret to every
  sender. The existing static token still works if you prefer it (#2788).
- **Variable and broadcast settings on dashboard filters**: a dashboard filter
  can now be configured as a variable and given broadcast settings, giving you
  more control over how its value is applied across the dashboard (#2836).
- **Dashboard variables resolve in raw SQL tiles**: a tile you write in raw SQL
  now has the dashboard's variables substituted into its query, so hand-written
  SQL responds to the same variables as the rest of the dashboard (#2873).
- **Sources can point at your own service version field**: log and trace sources
  take an optional `serviceVersionExpression` identifying the running release of
  a service. It defaults to the OpenTelemetry `service.version` resource
  attribute, so if your release identifier lives somewhere else — a container
  image tag under GitOps, say — you can point the source at it instead of
  changing your instrumentation (#2893).
- **Release markers on dashboard tile charts**: tile charts can overlay a marker
  where each version of a service first appeared, so you can line a deployment
  up against the change it caused in the data. Markers only cover the data the
  tile is charting and are tinted to match their service's series colour, and
  they are suppressed on charts where they can't be tied to a visible line — so
  an aggregate line spanning many services isn't annotated with releases you
  can't attribute to it. Hovering a marker lists every release in its cluster
  with the service that shipped it, its version and the time, so a collapsed
  "N releases" cluster names them all and a chart with more series than the
  legend shows is still readable (#2894, #2895).
- **Summary metrics over the MCP server**: summary-kind metrics are now exposed
  through the MCP server, so an agent can query them alongside the metric kinds
  it already supports (#2855).
- **Validate a whole dashboard in one MCP call**: a new `clickstack_query_tiles`
  tool runs the queries behind many tiles at once — it takes a dashboard ID and
  an optional list of tile IDs, defaulting to every non-markdown tile — and
  returns a compact per-tile success or failure summary with row counts, errors
  and raw-SQL macro warnings, plus an aggregate count. A tile that fails to
  query is reported inline rather than failing the whole call, so an agent can
  check a dashboard it has just saved in one or two calls instead of one
  `clickstack_query_tile` call per tile (#2889).

### 🧪 Experimental

- **Alert detail page**: a new page at `/alerts/:id` charts an alert's query
  against its threshold, widens the evaluation-history strip, and adds a
  paginated stream of evaluation events — with a per-group breakdown for
  group-by alerts, evaluation analytics columns and cursor pagination scoped to
  the time range you pick. The alerts page history strip also renders errored
  windows with their per-window error details. Set
  `NEXT_PUBLIC_ENABLE_ALERT_DETAILS` to enable it; it is off by default (#2835).

### 🔧 Improvements

- **Failed alert evaluations are kept, not overwritten**: query errors, timeouts
  and webhook failures are now recorded per evaluation window instead of leaving
  only a latest-only snapshot, so you can see exactly which windows failed and
  why — with query timeouts called out separately and an actionable message
  attached. Retries against the same window collapse into a single row, a failed
  window is still retried and backfilled, and its error entry is cleared once
  the window recovers. Every history row also carries evaluation analytics such
  as query and webhook durations (#2834).
- **Multi-series metric charts run as a single query**: a metric chart with
  several series now runs one composed ClickHouse query instead of a query per
  series merged in the browser, ratio charts included, so a chart with many
  series renders with fewer round trips. "View SQL" on a multi-series metric
  chart now shows the whole query rather than just the first series. What the
  chart draws is unchanged — result shape, gaps and ratio semantics all stay as
  they were (#2859).
- **Variable-aware validation and autocomplete in the SQL editor**: the SQL
  editor now autocompletes dashboard variables and validates how they are used,
  so a mistyped or undefined variable is flagged as you write the query rather
  than when you run it (#2874).
- **Dashboard deletion asks for confirmation**: deleting a dashboard from its
  detail page now prompts you to confirm before the dashboard is removed,
  matching the safeguard you already get elsewhere in the app (#2851).
- **Password requirements are shown on the Join Team page**: accepting a team
  invite and setting your password now shows the same live policy checklist as
  the register page, so you no longer have to guess the length, casing, number
  and special-character rules. The checklist had also drifted from the server in
  two ways that could show all-green ticks for a password the server rejects —
  a broader special-character pattern than the backend accepts, and no sign of
  the 72-character maximum — so both sides now read a single shared policy
  module, and a rejected password reports the specific rules it failed instead
  of a generic "Password is invalid" (#2904).
- **MCP tools declare whether they read or write**: every tool the MCP server
  exposes now carries annotations, so a client can distinguish read-only query
  tools from the save, patch and delete tools that overwrite or remove
  resources — useful for agents that ask before taking a destructive action
  (#2838).
- **MCP steers agents to the builder query tools ahead of raw SQL**: agents were
  reaching for `clickstack_sql` for the single-source aggregations, top-N and
  time-series that `clickstack_table`, `clickstack_timeseries` and
  `clickstack_search` express more reliably — and raw SQL failed about twice as
  often. Raw SQL is now described as a last resort, the builder tools carry a
  reciprocal nudge to prefer them over SQL, and a server-level tool-selection
  policy is surfaced when a client connects rather than only through the opt-in
  `query_guide` prompt (#2840).
- **Agent-built dashboard tiles get an editable filter**: an agent writing a
  table, line, stacked bar, number, pie or bar tile is now steered to put the
  filter in the per-series `where` on each select item — the box the chart
  editor shows as "Where" — and the save and patch tools reject a tile-level
  `where`/`whereLanguage` on those types with a message pointing at the
  per-series field, since the editor never renders a tile-level filter for them
  and it would be invisible and uneditable. Search, heatmap and event pattern
  tiles keep their tile-level filter (#2870).
- **The CLI's README documents every command**: the `@hyperdx/cli` README now
  covers the full feature set and command reference — the TUI, `chart`, `query`,
  sources, connections, dashboards, auth, team and `upload-sourcemaps` — so npm
  and GitHub show everything the CLI can do. `hdx chart --help` no longer points
  at the removed `hdx stream` command (#2866).
- **The dead alert-silence endpoint is gone**: `GET /ext/silence-alert/:token`
  and its unused code path have been removed. The endpoint never silenced
  anything, so there is nothing to change on your side (#2906).

### 🐛 Bug Fixes

- **Numeric and `Bool` map field searches work unquoted**: an equality search
  against a map subscript such as `Measures.latency_ms:250` was escaped a second
  time, so ClickHouse read the whole expression as one identifier rather than a
  map lookup. Quoting the value used to work around this for numeric maps, and
  `Map(String, Bool)` columns failed either way — both now resolve correctly
  (#2841).
- **Lucene autocomplete is back**: suggestions in the Lucene search bar had
  stopped appearing, and now work again (#2902).
- **A removed team member's session no longer breaks every request**: a browser
  still holding a session cookie for a deleted user was answered
  `500 Something went wrong :(` on every route, public ones included, so that
  person could neither accept a fresh invite nor log themselves out. The stale
  session is now treated as logged out — protected routes answer 401 and the
  browser is sent back to the login page (#2863).
- **Source writes validate the connection they reference**: creating or updating
  a source now rejects a connection that is malformed, missing, or owned by
  another team, rather than saving a source that points at something it cannot
  query (#2801).
- **Literal percent sequences survive in legacy JSON URLs**: a shared link
  carrying an older-style JSON query parameter no longer loses literal percent
  sequences in its values, so the link opens with the query you saved (#2785).
- **Collector logs no longer arrive mangled**: collector output was forwarded by
  a background `tail` process writing to the same stdout as the OpAMP
  supervisor, with nothing keeping the two streams apart, so log lines were
  interleaving mid-line. The supervisor's native `passthrough_logs` now re-emits
  the collector's output through its own logger, so each line comes through
  intact (#2800).

<!-- hyperdx-package-list -->

### 📦 Package changelogs

- `@hyperdx/api` 2.34.0 → 2.35.0 — [changelog](https://github.com/hyperdxio/hyperdx/blob/main/packages/api/CHANGELOG.md#2350)
- `@hyperdx/app` 2.34.0 → 2.35.0 — [changelog](https://github.com/hyperdxio/hyperdx/blob/main/packages/app/CHANGELOG.md#2350)
- `@hyperdx/cli` 0.6.0 → 0.6.1 — [changelog](https://github.com/hyperdxio/hyperdx/blob/main/packages/cli/CHANGELOG.md#061)
- `@hyperdx/common-utils` 0.25.0 → 0.26.0 — [changelog](https://github.com/hyperdxio/hyperdx/blob/main/packages/common-utils/CHANGELOG.md#0260)
- `@hyperdx/hdx-eval` 0.3.1 → 0.3.2 — [changelog](https://github.com/hyperdxio/hyperdx/blob/main/packages/hdx-eval/CHANGELOG.md#032)
- `@hyperdx/otel-collector` 2.34.0 → 2.35.0 — [changelog](https://github.com/hyperdxio/hyperdx/blob/main/packages/otel-collector/CHANGELOG.md#2350)

<!-- /hyperdx-package-list -->

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
