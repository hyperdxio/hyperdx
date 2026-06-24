# Observability & Instrumentation

HyperDX is an observability product, so our own code should be a shining example
of well-instrumented software. When you add or change a feature, instrument it
as part of the change - not as an afterthought.

This guide covers the conventions and the shared helpers. The principles are
aligned with the
[Instrumentation Score specification](https://github.com/instrumentation-score/spec/tree/main/rules).

## TL;DR (the non-negotiables)

1. **Every team-scoped operation carries team + user context.** Use
   `setBusinessContext(...)` so `hyperdx.team.id` / `hyperdx.user.id` end up on
   the trace. Auth middleware already does this for HTTP requests; background
   jobs and other entry points must do it themselves.
2. **If something is worth a log, it's usually worth a metric.** When a log line
   marks a countable event (an error, a skip, a fired alert, a query), emit a
   counter or histogram alongside it.
3. **Spans and metric attributes must be low-cardinality.** Never put raw
   queries, user input, IDs, or error messages into a span _name_ or a metric
   _attribute key/value enum_. IDs belong in span _attributes_, not names.
4. **Use the shared helpers** in
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
| `hyperdx.user.id`          | Acting user.                                               |
| `hyperdx.user.email`       | Acting user's email.                                       |
| `hyperdx.<domain>.<field>` | Domain IDs, e.g. `hyperdx.alert.id`, `hyperdx.source.id`.  |
| `feature_flag.<name>`      | Evaluated feature/config flag state.                       |

### Metrics

When you write a log line that marks a countable event, add a metric too.
Counters for occurrences, histograms for durations/sizes. Prefer counters and
histograms over gauges.

```ts
import {
  getCounter,
  getHistogram,
  recordDuration,
} from '@/utils/instrumentation';

const queryErrors = getCounter('hyperdx.search.query_errors', {
  description: 'Search query failures, labeled by ClickHouse error type.',
});
const queryDuration = getHistogram('hyperdx.search.query.duration_ms', {
  description: 'Search query duration.',
  unit: 'ms',
});

const result = await recordDuration(queryDuration, () => runQuery(cfg));
// ...on a known error:
queryErrors.add(1, { ch_error_type: chType });
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
