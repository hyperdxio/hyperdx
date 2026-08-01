# Observability & Instrumentation

HyperDX is an observability product, so our own code should be a shining example
of well-instrumented software. When you add or change a feature, instrument it
as part of the change - not as an afterthought.

This guide covers the conventions and the shared helpers. The principles are
aligned with the
[Instrumentation Score specification](https://github.com/instrumentation-score/spec/tree/main/rules).

## TL;DR (the non-negotiables)

1. **Every team-scoped operation carries team + user context.** Use
   `setBusinessContext(...)` so `hyperdx.team.id` / `user.id` end up on
   the trace. Auth middleware already does this for HTTP requests; background
   jobs and other entry points must do it themselves.
2. **If something is worth a log, put it on the span first.** The active span is
   the wide event for the current unit of work — attach the fact there as an
   attribute. If it also marks a countable event worth aggregating (an error, a
   skip, a fired alert, a query), emit a counter or histogram alongside it.
3. **Cardinality belongs on span _attributes_, not span _names_ or _metrics_.**
   Never put raw queries, user input, IDs, or error messages into a span _name_
   or a metric _attribute key/value_ — those must stay low-cardinality. Span
   _attributes_ are the opposite: enrich them freely with high-cardinality
   context (IDs, sizes, statuses), because that is what makes a trace queryable
   after the fact.
4. **Favor wide events for our own code — metrics stay first-class.** For the
   instrumentation _in this repo_ we lean on richly-attributed spans: before
   adding an instrument, ask whether the value belongs on the span for the work
   already in flight, and put point-in-time / gauge-style values (sizes, counts,
   depths, current state) there rather than in a gauge. This is an internal
   engineering preference, not a rule against metrics — counters and histograms
   remain first-class, feed alerts and SLOs, and many HyperDX deployments depend
   heavily on them. See [Wide events over gauges](#wide-events-over-gauges).
5. **Use the shared helpers** in
   [`packages/api/src/utils/instrumentation.ts`](../packages/api/src/utils/instrumentation.ts).
   Don't hand-roll tracer/meter lifecycle.

## The shared helper library

All manual instrumentation in `packages/api` goes through
`@/utils/instrumentation`:

| Helper                                                    | Purpose                                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `withSpan(name, fn, opts?)`                               | Run an async unit of work in an active span. Records exceptions, sets OK/ERROR status, always ends the span. |
| `setBusinessContext({ teamId, userId, email, ...extra })` | Attach standardized incident-remediation context to the trace + active span.                                 |
| `getStaticFeatureFlags()`                                 | Returns the static (env/compile-time) feature-flag states as `feature_flag.*` attributes.                    |
| `getCounter(name, opts?)` / `getHistogram(name, opts?)`   | Memoized OTel instrument accessors. Always use these instead of `meter.create*`.                             |
| `recordDuration(histogram, fn, attrs?)`                   | Run `fn`, recording its wall-clock duration on a histogram (even on throw).                                  |

The module also re-exports `SpanKind`, `SpanStatusCode`, and the relevant OTel
types, so a single import is usually enough.

### Tracing

Rely on the HyperDX SDK auto-instrumentation (HTTP, Express, Mongo, etc.) for
the common path. Add a **manual span only for a meaningful unit of work** that
auto-instrumentation can't see - a background job step, a fan-out, an expensive
computation, an external tool invocation.

```ts
import { withSpan } from '@/utils/instrumentation';

await withSpan(
  'alerts.process_batch',
  async span => {
    span.setAttribute('hyperdx.alerts.batch.size', alerts.length);
    return processBatch(alerts);
  },
  { attributes: { 'hyperdx.team.id': teamId } },
);
```

Span rules to follow (from the Instrumentation Score spec):

- **Bound span-name cardinality** (SPA-003): span names are constants or use
  route templates - never interpolate IDs, queries, or URLs into the name. Put
  those in attributes instead.
- **Don't over-span** (SPA-001, SPA-005): keep `INTERNAL` spans limited and
  meaningful. Never create a span per loop iteration or per trivial sub-call -
  it bloats traces and hurts performance.
- **Root spans are not `CLIENT`** (SPA-004): an entry point (HTTP handler, job
  tick) should open a `SERVER`/`INTERNAL` span before issuing outbound `CLIENT`
  calls. Auto-instrumentation handles this for HTTP; for headless workloads
  (cron tasks), wrap the work in a top-level span.

### Business context

Attach team/user context as early as possible (at the auth boundary or the top
of a job). `setBusinessContext` writes both to the whole trace (via the HyperDX
SDK, requires `HDX_NODE_BETA_MODE=1`) and to the active span.

```ts
import {
  getStaticFeatureFlags,
  setBusinessContext,
} from '@/utils/instrumentation';

setBusinessContext({
  teamId: user.team?.toString(),
  userId: user._id?.toString(),
  email: user.email,
  ...getStaticFeatureFlags(),
});
```

Standard attribute keys:

| Key                        | Meaning                                                    |
| -------------------------- | ---------------------------------------------------------- |
| `hyperdx.team.id`          | Owning team (multi-tenancy boundary). Set this everywhere. |
| `user.id`                  | Acting user (OTel `user.*` semconv).                       |
| `user.email`              | Acting user's email (OTel `user.*` semconv).               |
| `hyperdx.<domain>.<field>` | Domain IDs, e.g. `hyperdx.alert.id`, `hyperdx.source.id`.  |
| `feature_flag.<name>`      | Evaluated feature/config flag state.                       |

### Wide events over gauges

> **Scope:** this is HyperDX's _internal_ instrumentation philosophy for the
> code in this repo — not a recommendation that users pick wide events over
> metrics. Metrics are a first-class HyperDX signal that many operators rely on;
> nothing here discourages them. What follows is simply how _we_ prefer to
> instrument our own services.

We instrument in the spirit of
[wide events](https://boristane.com/blog/observability-wide-events-101/): one
richly-attributed span per unit of work beats a scatter of pre-aggregated
metrics. Pre-aggregation only answers the questions you thought to ask in
advance; a wide event lets you slice by any dimension _after_ the incident —
"aborted uploads, but only from agents on this collector version, over 5 MB" is
a trace query, not a metric you had the foresight to define.

The practical consequence for our code: **default away from gauges.** A gauge is
a point-in-time sample of a value, and that value almost always belongs to some
unit of work — a request body size, a batch length, a queue depth at dequeue, a
team count used to build a config. Prefer putting it on that operation's span as
an attribute. There it keeps its correlations (which agent, which team, which
outcome) and stays queryable across every other attribute on the event; a gauge
sheds all of that the moment it's recorded.

```ts
// Don't: a bare gauge, stripped of the context that makes it useful.
// meter.createObservableGauge('opamp.request.body_size')...

// Do: attach the point-in-time value to the span for the work in flight, where
// it can be sliced by agent, team, outcome, or any other span attribute.
span.setAttribute('opamp.request.body_size_bytes', req.body.length);
span.setAttribute('opamp.teams.count', teams.length);
```

Metrics still earn their place for **aggregate signals that must exist
independently of any single event** — availability/latency SLIs, error rates,
alert thresholds — because those stay correct under trace sampling and are cheap
to alert on. That's the counters and histograms below. What we skip is the
gauge: if a value is worth recording at a point in time, the span is where it
belongs.

The rare exception is an ambient value with no owning operation (a pool size or
queue depth sampled by a background poller). Even then, prefer emitting a
periodic wide event — a heartbeat span carrying the readings — over a raw gauge,
so the readings stay sliceable; fall back to a gauge only when no such event
exists.

### Metrics

When you write a log line that marks a countable event, add a metric too.
Counters for occurrences, histograms for durations/sizes. For our own code we
favor span attributes over gauges (see
[Wide events over gauges](#wide-events-over-gauges)), but metrics themselves are
first-class — reach for them for aggregate signals, alerts, and SLOs.

```ts
import {
  getCounter,
  getHistogram,
  recordDuration,
} from '@/utils/instrumentation';

const queryErrors = getCounter('hyperdx.search.query_errors', {
  description: 'Search query failures, labeled by error type.',
});
const queryDuration = getHistogram('hyperdx.search.query.duration_ms', {
  description: 'Search query duration.',
  unit: 'ms',
});

const result = await recordDuration(queryDuration, () => runQuery(cfg));
// ...on a known error:
queryErrors.add(1, { error_type: chType });
```

Metric conventions:

- **Naming**: `hyperdx.<domain>.<event>` (snake_case event), e.g.
  `hyperdx.alerts.evaluations`, `hyperdx.api.errors`.
- **Attributes are low-cardinality** (MET-001): use fixed enums
  (`{ outcome: 'fired' | 'resolved' | 'skipped_silenced' }`), status codes, or
  bounded error-type strings. Never user IDs, team IDs, raw messages, or query
  text.
- **Always pass a `description`** (and `unit` for histograms).
- **Define instruments at module scope** via `getCounter`/`getHistogram` so they
  are created once and reused.

### SLOs (operation metrics)

To make a piece of functionality SLO-able, wrap it with `withOperationMetrics`
(or call `recordOperationOutcome` directly when timing is managed manually, e.g.
a streaming proxy). Both emit a standard pair of SLI signals tagged with a
stable, low-cardinality `operation` name and `outcome` (`success` | `error`):

| Metric                          | Type      | Use as          |
| ------------------------------- | --------- | --------------- |
| `hyperdx.operation.requests`    | counter   | availability SLI |
| `hyperdx.operation.duration_ms` | histogram | latency SLI     |

```ts
import { withOperationMetrics } from '@/utils/instrumentation';

const chartConfig = await withOperationMetrics(
  'ai.assistant',
  () => generateChart(prompt),
  { source_kind: source.kind },
);
```

Because every operation reports through the same two metrics, an SLO is just a
filter on `operation` — availability = `outcome:success` / total, latency =
the duration histogram. Keep `operation` a constant (e.g. `ai.assistant`,
`clickhouse_proxy.query`); never interpolate IDs or user input into it. Reach
for this on functionality with real failure modes worth a target (external
dependencies, query proxies, AI calls) — not on thin CRUD that the HTTP
auto-instrumentation and error middleware already cover.

## Where to look for examples

- Generic span + status handling: `packages/api/src/utils/instrumentation.ts`
- Span + metrics wrapper around a unit of work:
  `packages/api/src/mcp/utils/tracing.ts`
- Context at the auth boundary: `packages/api/src/middleware/auth.ts`
- Error counter: `packages/api/src/middleware/error.ts`
- Outcome counters in a background job:
  `packages/api/src/tasks/checkAlerts/index.ts`
- Query duration + error metrics:
  `packages/api/src/routers/external-api/v2/search.ts` and `charts.ts`
- Scheduled-task metrics pattern: `packages/api/src/tasks/metrics.ts`
- Outcome counter + span on a non-HTTP entry point:
  `packages/api/src/opamp/controllers/opampController.ts`
- Duration + swallowed-error counters where errors never reach the error
  middleware: `packages/api/src/routers/api/prometheus.ts`
- Delivery attempt counter + duration around an outbound webhook:
  `packages/api/src/tasks/checkAlerts/template.ts`
- Connection lifecycle-event counter: `packages/api/src/models/index.ts`
- SLO operation metrics (`withOperationMetrics`) on an external dependency:
  `packages/api/src/routers/api/ai.ts`
- SLO operation metrics (`recordOperationOutcome`) on a streaming proxy:
  `packages/api/src/routers/api/clickhouseProxy.ts`
- End-to-end + sub-operation SLO metrics on a background job (alert evaluation
  and its data fetch): `packages/api/src/tasks/checkAlerts/index.ts`
  (`alerts.evaluate`, `alerts.query`)
