# HyperDX MCP Server — Next Improvements

Based on the n=1 rerun trajectories (`runs/2026-05-10T04-*`) after adding
`hyperdx_trace` and `hyperdx_log_patterns`, plus the schema audit (per-select
conditional `where`, derived-expression `groupBy`).

## High leverage

### 1. `hyperdx_segment_compare` — the missing primitive

**Where it shows up:** the 25-call ClickHouse `max_turns` failure on
latency-spike. About 10 of those 25 calls were variations of "is the slowness
concentrated on `tenant.tier`? on `feature_flag`? on `http.route`? on
`backend`? on `service.version`?" — manual iteration through candidate segment
columns. HDX wins this scenario partly because it finds the segment by
accident, partly because it bails to `hyperdx_trace`. Neither MCP makes the
actual question first-class.

**Shape:**

```ts
hyperdx_segment_compare({
  source, metric, spanFilter, timeWindow,
  segmentColumns?: string[]   // omit → use mapAttributeLowCardinalityValues
})
```

Returns each candidate segment ranked by metric spread (max/min ratio across
values) with a top-2 callout. `hyperdx_list_sources` already exposes
`mapAttributeLowCardinalityValues` — this tool just leverages that to
pre-compute the obvious comparisons.

### 2. `hyperdx_anomaly_window` — when did the change happen

ClickHouse burned 4 consecutive calls (~#7–#10 of the latency-spike run) doing
minute-bucketed p99 queries to find the inflection. HDX did the same in
calls #5 + #7. Both arms reach for this and both grind through it.

**Shape:**

```ts
hyperdx_anomaly_window({ source, metric, spanFilter, timeWindow, granularity?: 'auto' })
```

Returns the bucketed timeseries plus a detected onset timestamp and magnitude.
Replaces the "GROUP BY toStartOfMinute, eyeball the result" pattern.

### 3. `hyperdx_log_patterns` should support `compareWindow`

**Where it shows up:** noisy-signals is solved with one call now, but for
incident response the natural follow-up is "which patterns *spiked*?" The
agent currently has to call `hyperdx_log_patterns` twice and diff manually.

**Shape addition:**

```ts
hyperdx_log_patterns({
  ...,
  compareWindow?: { startTime, endTime }
})
```

Returns each cluster with `count_now`, `count_baseline`, `delta_pct`. Cheap to
implement (run the sample twice).

## Medium leverage

### 4. `hyperdx_trace` should auto-include correlated logs

The HDX agent's call #11 walked a trace and got 16 spans. To answer "what error
message" it would normally need a second log query joining on `TraceId`. Trace
sources have a configured `logSourceId` already (`source.logSourceId` in the
schema). The trace tool can pull correlated log lines and inline them at the
right span depth.

### 5. Single combined "first-look" tool

```ts
hyperdx_overview({
  source, focus: 'service' | 'span' | 'pattern', value, timeWindow
})
```

Returns:

- Timeseries of the focus's primary metric
- Top 5 error templates
- Top 3 differentiating segments
- Top 5 slowest `TraceId`s

**One call** that replaces the agent's ~5-call exploration phase. This is the
biggest tool-call savings — both agents spend 4–6 calls warming up.

### 6. Default a `limit` on builder `table` queries

Looking at HDX's `groupBy: "SpanAttributes['error.type'],
SpanAttributes['decline.reason'], ServiceName"` — that returns every
combination, which can be hundreds of rows. None of the runs hit this in a bad
way, but it's a footgun. Default to `limit: 50` with `orderBy` first column
desc unless explicitly set, and surface "result truncated" in the response.

## Description / discoverability

### 7. ToolSearch doesn't pre-load `hyperdx_trace` / `hyperdx_log_patterns`

In the error-root-cause run, the HDX agent did
`ToolSearch select:list_sources,query` first (call #1), then **a second**
`ToolSearch select:hyperdx_trace` later (call #10). That's a wasted turn.
**The fix isn't on the MCP server** — it's on the harness side or in the
system prompt. But: bundling the description so an agent loading
`hyperdx_query` *also* sees a pointer to `hyperdx_trace` / `hyperdx_log_patterns`
mentioned in the *first* response would help. Right now the cross-references
are in the description only.

### 8. `pickBy` description for `hyperdx_trace` slightly off

Doc says "earliest trace whose root span has `STATUS_CODE_ERROR`" but the
implementation actually filters by *any* span with that status (since the
picker groups by `TraceId`). Either tighten the implementation or fix the doc.

## What to skip

- **Don't add a `hyperdx_explain` ("what changed at time T") tool** — too
  generic, hard to make accurate, and `segment_compare` + `anomaly_window`
  together cover most of the value.
- **Don't split `hyperdx_query` into per-displayType tools** — same reasoning
  as before; one entry point is good.
- **Don't add an `attribute_keys` tool** — `list_sources` already returns
  `mapAttributeKeys` and `mapAttributeLowCardinalityValues`, which is exactly
  the right shape.

## Honest caveat on the n=1 result

The latency-spike flip (HDX 43% → 82%, CH 60% → 26%) looks dramatic but n=1
is high variance and CH hitting `max_turns` is partly bad luck. The real test
is whether at n≥3 the HDX advantage holds *without* CH happening to time out.
Worth running n=3 on latency-spike specifically to confirm before claiming the
new tools deliver that magnitude of improvement.
