import { setTraceAttributes } from '@hyperdx/node-opentelemetry';
import opentelemetry, {
  Attributes,
  AttributeValue,
  Counter,
  Histogram,
  MetricOptions,
  Span,
  SpanKind,
  SpanStatusCode,
} from '@opentelemetry/api';
import { performance } from 'perf_hooks';

import {
  AI_API_KEY,
  ANTHROPIC_API_KEY,
  CODE_VERSION,
  IS_CI,
  IS_DEV,
  IS_LOCAL_APP_MODE,
  IS_PROMQL_ENABLED,
  RUN_SCHEDULED_TASKS_EXTERNALLY,
  USAGE_STATS_ENABLED,
} from '@/config';
import logger from '@/utils/logger';

/**
 * Centralized tracing + metrics helpers for the API.
 *
 * This module is the single import surface for manual instrumentation so that
 * call sites don't manage tracer/meter lifecycle or duplicate span boilerplate.
 * See `agent_docs/observability.md` for conventions and usage examples.
 */

const INSTRUMENTATION_SCOPE = 'hyperdx-api';

const tracer = opentelemetry.trace.getTracer(
  INSTRUMENTATION_SCOPE,
  CODE_VERSION,
);
const meter = opentelemetry.metrics.getMeter(
  INSTRUMENTATION_SCOPE,
  CODE_VERSION,
);

// Re-export the OTel primitives most call sites need, so a single import from
// `@/utils/instrumentation` is enough for typical instrumentation work.
export {
  type Attributes,
  type Counter,
  type Histogram,
  type Span,
  SpanKind,
  SpanStatusCode,
};

export type WithSpanOptions = {
  attributes?: Attributes;
  kind?: SpanKind;
  /**
   * Whether to set an OK status on the span when the handler resolves without
   * throwing. Defaults to true. Set to false when the caller wants to manage
   * the span status itself (e.g. mapping a non-throwing error result to ERROR).
   */
  recordOkStatus?: boolean;
};

/**
 * Wraps an async unit of work in an active span. Records exceptions, sets span
 * status, and always ends the span. The thrown error is re-raised unchanged.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  options: WithSpanOptions = {},
): Promise<T> {
  const { attributes, kind, recordOkStatus = true } = options;
  return tracer.startActiveSpan(name, { attributes, kind }, async span => {
    try {
      const result = await fn(span);
      if (recordOkStatus) {
        span.setStatus({ code: SpanStatusCode.OK });
      }
      return result;
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      span.end();
    }
  });
}

export type BusinessContext = {
  teamId?: string | null;
  userId?: string | null;
  email?: string | null;
  [key: string]: AttributeValue | null | undefined;
};

/**
 * Attaches incident-remediation context to the whole trace (via the HyperDX
 * SDK) and to the active span. Standardizes the attribute keys so team/user
 * context is consistent across every code path.
 *
 * User attributes follow the OTel `user.*` semantic conventions (currently
 * experimental). Team has no OTel equivalent, so it stays under the `hyperdx.*`
 * namespace. Note these are the server-side API trace attributes and are
 * distinct from the browser-RUM session attributes (`userEmail`, `userName`).
 *
 * NOTE: trace-wide attributes require `HDX_NODE_BETA_MODE=1`.
 */
export function setBusinessContext(context: BusinessContext): void {
  const { teamId, userId, email, ...extra } = context;

  const attributes: Attributes = {};
  if (teamId != null) {
    attributes['hyperdx.team.id'] = String(teamId);
  }
  if (userId != null) {
    attributes['user.id'] = String(userId);
  }
  if (email != null) {
    attributes['user.email'] = String(email);
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value != null) {
      attributes[key] = value;
    }
  }

  if (Object.keys(attributes).length === 0) {
    return;
  }

  setTraceAttributes(attributes);
  opentelemetry.trace.getActiveSpan()?.setAttributes(attributes);
}

/**
 * Returns the static (env / compile-time) feature flag states as span/trace
 * attributes. The repo has no dynamic flag service, so these are the toggles
 * that actually change behavior and are useful during incident remediation.
 */
export function getStaticFeatureFlags(): Attributes {
  return {
    'feature_flag.local_app_mode': IS_LOCAL_APP_MODE,
    'feature_flag.promql_enabled': IS_PROMQL_ENABLED,
    'feature_flag.usage_stats_enabled': USAGE_STATS_ENABLED,
    'feature_flag.ai_assistant_enabled': !!(AI_API_KEY || ANTHROPIC_API_KEY),
    'feature_flag.scheduled_tasks_external': RUN_SCHEDULED_TASKS_EXTERNALLY,
  };
}

type CachedInstrument<T> = { instrument: T; options?: MetricOptions };

const counters = new Map<string, CachedInstrument<Counter>>();
const histograms = new Map<string, CachedInstrument<Histogram>>();

/**
 * Warns (in dev/CI only) when a cached instrument is re-requested with options
 * that differ from the ones it was first registered with. The first registration
 * wins, so a mismatch means the new description/unit/etc. is silently dropped —
 * usually a typo or a duplicate name defined in another module.
 */
function warnOnOptionsMismatch(
  kind: string,
  name: string,
  existing: MetricOptions | undefined,
  next: MetricOptions | undefined,
): void {
  if (!IS_DEV && !IS_CI) {
    return;
  }
  // Only flag when the caller actually passed options to compare against.
  if (next == null) {
    return;
  }
  if (JSON.stringify(existing) !== JSON.stringify(next)) {
    logger.warn(
      {
        metric: name,
        registeredOptions: existing,
        ignoredOptions: next,
      },
      `${kind} "${name}" is already registered with different options; ` +
        `the original definition is kept and the new options are ignored.`,
    );
  }
}

/**
 * Returns a memoized counter for `name`, creating it on first use. Always use
 * this instead of `meter.createCounter` so instruments are shared across calls.
 */
export function getCounter(name: string, options?: MetricOptions): Counter {
  const cached = counters.get(name);
  if (cached) {
    warnOnOptionsMismatch('Counter', name, cached.options, options);
    return cached.instrument;
  }
  const instrument = meter.createCounter(name, options);
  counters.set(name, { instrument, options });
  return instrument;
}

/** Memoized histogram accessor. See {@link getCounter}. */
export function getHistogram(name: string, options?: MetricOptions): Histogram {
  const cached = histograms.get(name);
  if (cached) {
    warnOnOptionsMismatch('Histogram', name, cached.options, options);
    return cached.instrument;
  }
  const instrument = meter.createHistogram(name, options);
  histograms.set(name, { instrument, options });
  return instrument;
}

/**
 * Runs `fn`, recording its wall-clock duration (ms) on `histogram` regardless
 * of whether it resolves or rejects.
 */
export async function recordDuration<T>(
  histogram: Histogram,
  fn: () => Promise<T>,
  attributes?: Attributes,
): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    histogram.record(performance.now() - start, attributes);
  }
}

/**
 * The outcome of one execution of an instrumented operation. Deliberately a
 * two-value enum so it maps cleanly onto an SLO "good vs. total" split.
 */
export type OperationOutcome = 'success' | 'error';

// Shared SLI instruments. Every instrumented operation reports through the same
// two metrics, distinguished by the low-cardinality `operation` attribute, so
// SLO dashboards/queries can be written generically (filter by `operation`)
// rather than per-metric. See agent_docs/observability.md ("SLOs").
const operationRequestsCounter = getCounter('hyperdx.operation.requests', {
  description:
    'Count of instrumented application operations, labeled by operation and outcome (success, error). Availability SLI for SLOs.',
});
const operationDurationHistogram = getHistogram(
  'hyperdx.operation.duration_ms',
  {
    description:
      'Wall-clock duration of instrumented application operations, labeled by operation and outcome. Latency SLI for SLOs.',
    unit: 'ms',
  },
);

/**
 * Records the SLI signals for a single execution of a named operation: bumps
 * `hyperdx.operation.requests` and records `hyperdx.operation.duration_ms`,
 * both tagged with `operation` + `outcome` (plus any extra `attributes`).
 *
 * Prefer {@link withOperationMetrics} for the common async case. Use this
 * directly only when timing is managed manually and there is no single async
 * function to wrap (e.g. streaming proxies or event-callback APIs).
 *
 * `operation` is a metric attribute, so it must be a stable, low-cardinality
 * constant (e.g. `ai.assistant`) — never interpolate IDs, queries, or user
 * input into it.
 */
export function recordOperationOutcome(args: {
  operation: string;
  outcome: OperationOutcome;
  durationMs: number;
  attributes?: Attributes;
}): void {
  const { operation, outcome, durationMs, attributes } = args;
  const attrs: Attributes = { ...attributes, operation, outcome };
  operationRequestsCounter.add(1, attrs);
  operationDurationHistogram.record(durationMs, attrs);
}

/**
 * Wraps a unit of application functionality so it emits the request-count and
 * duration SLIs needed to define an SLO. A resolved promise is recorded as
 * `success`, a thrown error as `error`; the error is always re-raised
 * unchanged.
 *
 * Build an availability SLO from `hyperdx.operation.requests`
 * (good = `outcome:success`) and a latency SLO from
 * `hyperdx.operation.duration_ms`, filtering both by the `operation` attribute.
 */
export async function withOperationMetrics<T>(
  operation: string,
  fn: () => Promise<T>,
  attributes?: Attributes,
): Promise<T> {
  const start = performance.now();
  let outcome: OperationOutcome = 'success';
  try {
    return await fn();
  } catch (err) {
    outcome = 'error';
    throw err;
  } finally {
    recordOperationOutcome({
      operation,
      outcome,
      durationMs: performance.now() - start,
      attributes,
    });
  }
}
