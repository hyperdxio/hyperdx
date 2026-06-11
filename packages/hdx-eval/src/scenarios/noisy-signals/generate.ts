import { makeLog } from '../../generators/logs';
import {
  analyticsEventLog,
  backgroundLog,
  billingEventLog,
  buildResourcePool,
  cacheHitLog,
  catalogLog,
  caughtExceptionLog,
  consoleLogDumpLog,
  envoyAccessLog,
  heartbeatLog,
  indexingLog,
  jobFailedPermanentLog,
  normalizeSeverityText,
  notificationDeliveryLog,
  pageRenderLog,
  pickResource,
  pickSeverityIn,
  searchCacheMissVerboseLog,
  serviceOpsDebugLog,
  spreadTimestamp,
  subscriptionMetricLog,
  upstreamHealthProbeLog,
} from '../../generators/templates';
import type { LogRow } from '../../generators/types';
import type { GenerateContext, Scenario, ScenarioBatch } from '../types';
import groundTruth from './ground-truth.json';

const HISTORY_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 10_000;

// Composite-cell design: every (ServiceName, SeverityText) cell that holds a
// noisy pattern also holds a high-volume LEGITIMATE pattern of comparable
// size. `GROUP BY ServiceName, SeverityText` no longer identifies noise —
// the agent has to look at event.name / body templates.
//
// Total ≈ 16M logs.
//
//   cell                            NOISE                  LOAD-BEARING
//   notification-service × DEBUG    cache.hit              notification.delivery
//   billing-service × INFO          subscription_mrr-log   invoice / refund / sub events
//   worker × ERROR                  NonFatalRetryableError job.failed.permanent
//   {inv,pri,ship,rec}-svc × DEBUG  health.check           per-svc ops debug
//   frontend-proxy × INFO           lb.health.probe        envoy access
//   frontend × INFO                 console.log_dump       page.render
//   search-service × INFO           search.cache.miss      index.shard.flush
const DEFAULTS = {
  // Composite cell 1 (notification-service × DEBUG)
  CACHE_HIT: 1_000_000, // ~6.7% NOISE
  NOTIFICATION_DELIVERY: 1_000_000, // ~6.7% LOAD-BEARING

  // Composite cell 2 (billing-service × INFO)
  SUBSCRIPTION: 1_000_000, // ~6.7% NOISE (metric-as-log)
  BILLING_EVENTS: 1_000_000, // ~6.7% LOAD-BEARING (invoice/refund/sub)

  // Composite cell 3 (worker × ERROR)
  STACKTRACE: 400_000, // ~2.7% NOISE (caught)
  JOB_FAILED: 400_000, // ~2.7% LOAD-BEARING (permanent)

  // Composite cell 4 ({inv,pri,ship,rec}-service × DEBUG)
  HEARTBEAT: 2_000_000, // ~13.3% NOISE across 4 services
  SERVICE_OPS: 2_000_000, // ~13.3% LOAD-BEARING across same 4 services

  // Composite cell 5 (frontend-proxy × INFO)
  LB_PROBE: 1_000_000, // ~6.7% NOISE
  ACCESS_LOG: 1_000_000, // ~6.7% LOAD-BEARING

  // Composite cell 6 (frontend × INFO)
  CONSOLE_DUMP: 800_000, // ~5.3% NOISE
  PAGE_RENDER: 800_000, // ~5.3% LOAD-BEARING

  // Composite cell 7 (search-service × INFO)
  SEARCH_MISS: 600_000, // ~4% NOISE
  INDEXING: 600_000, // ~4% LOAD-BEARING

  // Single-pattern cells (analytics is load-bearing-only; catalog + bg
  // contribute variety so the cells above aren't the only thing in the
  // table).
  ANALYTICS: 600_000, // ~4% LOAD-BEARING (no noise twin)
  CATALOG_LOOKUP: 400_000, // ~2.7% mixed-info background
  BACKGROUND_VARIED: 1_400_000, // ~9.3% genuine variety
};

type Rng = GenerateContext['rng'];

function spread(i: number, total: number, startMs: number): number {
  return spreadTimestamp(i, total, startMs, HISTORY_WINDOW_MS);
}

// ─── Generic log-phase generator ──────────────────────────────────────────
// Most phases follow the same skeleton: loop N times, spread timestamps,
// call a template function, push a log row, yield in batches. This generic
// eliminates the per-phase boilerplate.

type TemplateResult = { body: string; attrs: Record<string, string> };

function* streamLogPhase(opts: {
  rng: Rng;
  startMs: number;
  count: number;
  batchSize: number;
  serviceName: string | ((i: number) => string);
  severityText: LogRow['severityText'];
  template: (rng: Rng, t: number, svc: string) => TemplateResult;
  extraAttrs?: (rng: Rng, t: number) => Record<string, string>;
  resourcePool: Record<string, Record<string, string>[]>;
}): Iterable<ScenarioBatch> {
  const {
    rng,
    startMs,
    count,
    batchSize,
    severityText,
    template,
    extraAttrs,
    resourcePool,
  } = opts;
  const resolveSvc =
    typeof opts.serviceName === 'function'
      ? opts.serviceName
      : () => opts.serviceName as string;
  const buf: LogRow[] = [];
  for (let i = 0; i < count; i++) {
    const t = spread(i, count, startMs);
    const svc = resolveSvc(i);
    const tmpl = template(rng, t, svc);
    buf.push(
      makeLog({
        timestampMs: t,
        serviceName: svc,
        severityText,
        body: tmpl.body,
        resourceAttributes: pickResource(rng, resourcePool, svc),
        logAttributes: extraAttrs
          ? { ...tmpl.attrs, ...extraAttrs(rng, t) }
          : tmpl.attrs,
      }),
    );
    if (buf.length >= batchSize) {
      yield { traces: [], logs: buf.splice(0, buf.length) };
    }
  }
  if (buf.length) yield { traces: [], logs: buf };
}

export const noisySignalsScenario: Scenario = {
  name: 'noisy-signals',
  agentPrompt: groundTruth.agentPrompt,
  description:
    '~16M logs across composite (service, severity) cells. Each cell that contains a noise pattern (drop/throttle candidate) also contains a high-volume LOAD-BEARING pattern of comparable size. Grouping by service+severity alone cannot identify noise — the agent must inspect event.name / body templates to disambiguate keep-vs-drop within each cell.',
  *generate(ctx): Iterable<ScenarioBatch> {
    const { rng, nowMs } = ctx;
    const startMs = nowMs - HISTORY_WINDOW_MS;
    const batchSize = ctx.batchSize ?? DEFAULT_BATCH_SIZE;
    const factor = ctx.volumeFactor ?? 1;
    const counts = scaleCounts(DEFAULTS, factor);

    const FOUR_SERVICES = [
      'inventory-service',
      'pricing-service',
      'shipping-service',
      'recommendation-service',
    ] as const;

    // All services used across phases — pre-build a resource pool so we
    // pick from ~24 pre-built objects per service instead of constructing
    // a fresh 18-key resource-attributes object on every row.
    const ALL_SERVICES = [
      'notification-service',
      'billing-service',
      'worker',
      ...FOUR_SERVICES,
      'frontend-proxy',
      'frontend',
      'search-service',
      'analytics-service',
      'product-catalog',
      // Background varied services
      'auth-service',
      'tax-service',
      'fraud-detection',
      'kafka',
      'payment-service',
      'cart-service',
      'session-service',
      'webhook-relay',
      'feature-flags',
      'image-service',
    ] as const;
    const resourcePool = buildResourcePool({
      rng,
      services: ALL_SERVICES,
    });

    const base = { rng, startMs, batchSize, resourcePool };

    // Composite cell 1: notification-service × DEBUG
    yield* streamLogPhase({
      ...base,
      count: counts.CACHE_HIT,
      serviceName: 'notification-service',
      severityText: 'DEBUG',
      template: (r, t) => cacheHitLog({ rng: r, nowMs: t }),
    });
    yield* streamLogPhase({
      ...base,
      count: counts.NOTIFICATION_DELIVERY,
      serviceName: 'notification-service',
      severityText: 'DEBUG',
      template: (r, t) => notificationDeliveryLog({ rng: r, nowMs: t }),
    });
    // Composite cell 2: billing-service × INFO
    yield* streamLogPhase({
      ...base,
      count: counts.SUBSCRIPTION,
      serviceName: 'billing-service',
      severityText: 'INFO',
      template: (r, t) => subscriptionMetricLog({ rng: r, nowMs: t }),
    });
    yield* streamLogPhase({
      ...base,
      count: counts.BILLING_EVENTS,
      serviceName: 'billing-service',
      severityText: 'INFO',
      template: (r, t) => billingEventLog({ rng: r, nowMs: t }),
    });
    // Composite cell 3: worker × ERROR
    yield* streamLogPhase({
      ...base,
      count: counts.STACKTRACE,
      serviceName: 'worker',
      severityText: 'ERROR',
      template: (r, t) => caughtExceptionLog({ rng: r, nowMs: t }),
    });
    yield* streamLogPhase({
      ...base,
      count: counts.JOB_FAILED,
      serviceName: 'worker',
      severityText: 'ERROR',
      template: (r, t) => jobFailedPermanentLog({ rng: r, nowMs: t }),
    });
    // Composite cell 4: 4-service × DEBUG
    yield* streamLogPhase({
      ...base,
      count: counts.HEARTBEAT,
      serviceName: (i: number) => FOUR_SERVICES[i % FOUR_SERVICES.length],
      severityText: 'DEBUG',
      template: (r, t, svc) =>
        heartbeatLog({ rng: r, nowMs: t, serviceName: svc }),
    });
    yield* streamLogPhase({
      ...base,
      count: counts.SERVICE_OPS,
      serviceName: (i: number) => FOUR_SERVICES[i % FOUR_SERVICES.length],
      severityText: 'DEBUG',
      template: (r, t, svc) =>
        serviceOpsDebugLog({
          rng: r,
          nowMs: t,
          serviceName: svc as (typeof FOUR_SERVICES)[number],
        }),
    });
    // Composite cell 5: frontend-proxy × INFO
    yield* streamLogPhase({
      ...base,
      count: counts.LB_PROBE,
      serviceName: 'frontend-proxy',
      severityText: 'INFO',
      template: (r, t) => upstreamHealthProbeLog({ rng: r, nowMs: t }),
    });
    yield* streamLogPhase({
      ...base,
      count: counts.ACCESS_LOG,
      serviceName: 'frontend-proxy',
      severityText: 'INFO',
      template: (r, t) => envoyAccessLog({ rng: r, nowMs: t }),
      extraAttrs: r => ({ _severity_raw: pickSeverityIn(r, 'info').text }),
    });
    // Composite cell 6: frontend × INFO
    yield* streamLogPhase({
      ...base,
      count: counts.CONSOLE_DUMP,
      serviceName: 'frontend',
      severityText: 'INFO',
      template: (r, t) => consoleLogDumpLog({ rng: r, nowMs: t }),
    });
    yield* streamLogPhase({
      ...base,
      count: counts.PAGE_RENDER,
      serviceName: 'frontend',
      severityText: 'INFO',
      template: (r, t) => pageRenderLog({ rng: r, nowMs: t }),
    });
    // Composite cell 7: search-service × INFO
    yield* streamLogPhase({
      ...base,
      count: counts.SEARCH_MISS,
      serviceName: 'search-service',
      severityText: 'INFO',
      template: (r, t) => searchCacheMissVerboseLog({ rng: r, nowMs: t }),
    });
    yield* streamLogPhase({
      ...base,
      count: counts.INDEXING,
      serviceName: 'search-service',
      severityText: 'INFO',
      template: (r, t) => indexingLog({ rng: r, nowMs: t }),
    });
    // Single-pattern cells
    yield* streamLogPhase({
      ...base,
      count: counts.ANALYTICS,
      serviceName: 'analytics-service',
      severityText: 'INFO',
      template: (r, t) => analyticsEventLog({ rng: r, nowMs: t }),
    });
    yield* streamLogPhase({
      ...base,
      count: counts.CATALOG_LOOKUP,
      serviceName: 'product-catalog',
      severityText: 'INFO',
      template: (r, t) => {
        const sev = pickSeverityIn(r, 'info');
        const tmpl = catalogLog({
          rng: r,
          nowMs: t,
          level: sev.text.toLowerCase(),
        });
        return {
          body: tmpl.body,
          attrs: { ...tmpl.attrs, _severity_raw: sev.text },
        };
      },
    });
    // Background varied — custom logic, uses phaseBackgroundVaried
    yield* phaseBackgroundVaried(
      rng,
      startMs,
      counts.BACKGROUND_VARIED,
      batchSize,
      resourcePool,
    );
  },
  groundTruth,
};

function scaleCounts<T extends Record<string, number>>(
  defaults: T,
  factor: number,
): T {
  const out = {} as T;
  for (const k of Object.keys(defaults) as (keyof T)[]) {
    (out[k] as number) = Math.max(1, Math.round(defaults[k] * factor));
  }
  return out;
}

function* phaseBackgroundVaried(
  rng: Rng,
  startMs: number,
  count: number,
  batchSize: number,
  resourcePool: Record<string, Record<string, string>[]>,
): Iterable<ScenarioBatch> {
  const buf: LogRow[] = [];
  const services = [
    'auth-service',
    'shipping-service',
    'tax-service',
    'fraud-detection',
    'recommendation-service',
    'kafka',
    'payment-service',
    'cart-service',
    'session-service',
    'webhook-relay',
    'feature-flags',
    'image-service',
  ];
  for (let i = 0; i < count; i++) {
    const t = spread(i, count, startMs);
    const svc = services[i % services.length];
    const sev = rng.weightedPick<'info' | 'warn' | 'error' | 'debug' | 'trace'>(
      [
        { value: 'info', weight: 78 },
        { value: 'warn', weight: 14 },
        { value: 'error', weight: 5 },
        { value: 'debug', weight: 2 },
        { value: 'trace', weight: 1 },
      ],
    );
    const sevPick = pickSeverityIn(rng, sev);
    const body = backgroundLog({ rng, nowMs: t });
    buf.push(
      makeLog({
        timestampMs: t,
        serviceName: svc,
        severityText: normalizeSeverityText(sevPick.text),
        body,
        resourceAttributes: pickResource(rng, resourcePool, svc),
        logAttributes: {
          'event.name': 'app.background',
          'log.iostream': 'stdout',
          logtag: 'F',
          _severity_raw: sevPick.text,
        },
      }),
    );
    if (buf.length >= batchSize) {
      yield { traces: [], logs: buf.splice(0, buf.length) };
    }
  }
  if (buf.length) yield { traces: [], logs: buf };
}
