// PromQL sections of the prompts, appended only while PromQL is enabled. Kept
// out of content.ts so that file does not grow further. Voice-clean like
// content.ts: no em-dashes, no AI hallmarks.

/** Appended to the query_guide prompt. */
export const PROMQL_QUERY_GUIDE_SECTION = `== PROMQL SOURCES ==

A source with kind "promql" holds Prometheus metrics, from a Prometheus-compatible endpoint or a ClickHouse TimeSeries table. It is queried with PromQL, not with the builder tools: clickstack_timeseries, clickstack_table and clickstack_search do not read it, and clickstack_sql only reaches a TimeSeries table's raw tags and samples.

Discovery workflow:
  1. clickstack_list_sources: find the source with kind "promql" and its backend ("prometheus" or "clickhouse").
  2. clickstack_describe_source(sourceId): lists its metric names and label names.
  3. clickstack_promql(sourceId, expression, startTime, endTime): run the expression. The default queryType "range" returns time series rows; queryType "instant" evaluates once at endTime and returns one row per series with a column per label (use it for "what is the value right now" and top-N questions).
  4. To keep a chart, save it as a PromQL tile (see "PROMQL TILES" in the create_dashboard prompt) and validate it with clickstack_query_tile. A tile with the same expression and granularity returns the same rows clickstack_promql did.

Writing expressions:
  Counters only ever go up, so plot their rate, never their raw value:
    sum by (job) (rate(http_requests_total[$__rate_interval]))
    sum by (job) (increase(http_requests_total[$__range]))        total over the whole time range (instant query)
  Gauges are plotted as they are:
    avg by (instance) (node_memory_Active_bytes)
  Error ratio:
    sum by (job) (rate(http_requests_total{status=~"5.."}[$__rate_interval])) / sum by (job) (rate(http_requests_total[$__rate_interval]))
  Percentiles from a histogram (aggregate by le first):
    histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[$__rate_interval])))
  Label matchers: {job="checkout"} exact, {job=~"check.*"} regex, {job!="cart"} not equal.
  Top-N (instant query): topk(5, sum by (instance) (rate(http_requests_total[$__rate_interval])))

Macros, expanded before the query is sent:
  $__interval       The step between points, e.g. 60s. Use it as a range: avg_over_time(metric[$__interval]).
  $__rate_interval  A safe range for rate() and increase(): the larger of 4 scrape intervals and $__interval plus one scrape interval. Prefer it over a fixed [5m].
  $__range          The whole selected time range, e.g. 3600s. For increase(metric[$__range]) in an instant query.

granularity sets the step of a range query and $__interval. Omit it for the automatic step (about 80 points over the range). Use the "<number> <unit>" format, e.g. "5 minute", the same as a PromQL tile.

Common mistakes:
  - rate() on a gauge, or a raw counter without rate()/increase(). A counter reset then looks like a spike.
  - A range selector shorter than the scrape interval, e.g. rate(x[15s]) on 30s scrapes: empty result. Use $__rate_interval.
  - histogram_quantile without sum by (le): one quantile per series instead of one overall.
  - A dashboard variable such as $job in clickstack_promql. There is no dashboard, so write the value inline; variables only work inside a PromQL tile.
  - Using the builder tools or clickstack_sql for a PromQL source when clickstack_promql answers the question directly.`;

/** Appended to the create_dashboard prompt. */
export const PROMQL_DASHBOARD_SECTION = `== PROMQL TILES ==

Sources with kind "promql" hold Prometheus metrics. Chart them with PROMQL tiles, not builder or raw SQL tiles:
  { "name": "Request rate", "config": { "configType": "promql", "displayType": "line", "sourceId": "<promql source id>", "expressions": [{ "expression": "sum by (job) (rate(http_requests_total{job=~\\"$job\\"}[$__rate_interval]))" }], "legendTemplate": "{{job}}" } }

  - displayType works as for builder tiles. line, stacked_bar and stacked_line plot every expression; number, table, pie and bar query only the first and can set queryType "instant" to evaluate once at the end of the range.
  - legendTemplate names each series from its labels, e.g. "{{job}} / {{instance}}".
  - Filter with a PROMETHEUS_LABEL dashboard filter: { "type": "PROMETHEUS_LABEL", "name": "Job", "sourceId": "<promql source id>", "label": "job", "variableName": "job" }. Tiles reference it in a matcher: {job=~"$job"} (multi-select) or {job="$job"} with maxSelections: 1. clickstack_describe_source lists the label names.
  - Draft each expression with clickstack_promql first, then validate the saved tile with clickstack_query_tile. PromQL tiles cannot have alerts.
  - Fetch the query_guide prompt for the PromQL syntax notes (rate(), histogram_quantile, the $__rate_interval macro).`;
