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
  IS_LOCAL_APP_MODE,
  IS_PROMQL_ENABLED,
  RUN_SCHEDULED_TASKS_EXTERNALLY,
  USAGE_STATS_ENABLED,
} from '@/config';

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
 * NOTE: trace-wide attributes require `HDX_NODE_BETA_MODE=1`.
 */
export function setBusinessContext(context: BusinessContext): void {
  const { teamId, userId, email, ...extra } = context;

  const attributes: Attributes = {};
  if (teamId != null) {
    attributes['hyperdx.team.id'] = String(teamId);
  }
  if (userId != null) {
    attributes['hyperdx.user.id'] = String(userId);
  }
  if (email != null) {
    attributes['hyperdx.user.email'] = String(email);
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

const counters = new Map<string, Counter>();
const histograms = new Map<string, Histogram>();

/**
 * Returns a memoized counter for `name`, creating it on first use. Always use
 * this instead of `meter.createCounter` so instruments are shared across calls.
 */
export function getCounter(name: string, options?: MetricOptions): Counter {
  let counter = counters.get(name);
  if (!counter) {
    counter = meter.createCounter(name, options);
    counters.set(name, counter);
  }
  return counter;
}

/** Memoized histogram accessor. See {@link getCounter}. */
export function getHistogram(name: string, options?: MetricOptions): Histogram {
  let histogram = histograms.get(name);
  if (!histogram) {
    histogram = meter.createHistogram(name, options);
    histograms.set(name, histogram);
  }
  return histogram;
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
