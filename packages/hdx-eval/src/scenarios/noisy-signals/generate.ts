import { makeLog } from '../../generators/logs';
import {
  analyticsEventLog,
  backgroundLog,
  billingEventLog,
  buildResourceAttrs,
  cacheHitLog,
  catalogLog,
  caughtExceptionLog,
  consoleLogDumpLog,
  envoyAccessLog,
  heartbeatLog,
  indexingLog,
  jobFailedPermanentLog,
  notificationDeliveryLog,
  pageRenderLog,
  pickSeverity,
  pickSeverityIn,
  searchCacheMissVerboseLog,
  serviceOpsDebugLog,
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

function* emitBatched(
  rows: LogRow[],
  batchSize: number,
): Iterable<ScenarioBatch> {
  for (let i = 0; i < rows.length; i += batchSize) {
    yield { traces: [], logs: rows.slice(i, i + batchSize) };
  }
}

function spread(i: number, total: number, startMs: number): number {
  return total > 1
    ? startMs + (i / (total - 1)) * (HISTORY_WINDOW_MS - 30_000)
    : startMs;
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

    // Composite cell 1: notification-service × DEBUG
    yield* phaseCacheHit(rng, startMs, counts.CACHE_HIT, batchSize);
    yield* phaseNotificationDelivery(
      rng,
      startMs,
      counts.NOTIFICATION_DELIVERY,
      batchSize,
    );
    // Composite cell 2: billing-service × INFO
    yield* phaseSubscription(rng, startMs, counts.SUBSCRIPTION, batchSize);
    yield* phaseBillingEvents(rng, startMs, counts.BILLING_EVENTS, batchSize);
    // Composite cell 3: worker × ERROR
    yield* phaseStacktrace(rng, startMs, counts.STACKTRACE, batchSize);
    yield* phaseJobFailed(rng, startMs, counts.JOB_FAILED, batchSize);
    // Composite cell 4: 4-service × DEBUG
    yield* phaseHeartbeat(rng, startMs, counts.HEARTBEAT, batchSize);
    yield* phaseServiceOps(rng, startMs, counts.SERVICE_OPS, batchSize);
    // Composite cell 5: frontend-proxy × INFO
    yield* phaseLbProbe(rng, startMs, counts.LB_PROBE, batchSize);
    yield* phaseAccessLog(rng, startMs, counts.ACCESS_LOG, batchSize);
    // Composite cell 6: frontend × INFO
    yield* phaseConsoleDump(rng, startMs, counts.CONSOLE_DUMP, batchSize);
    yield* phasePageRender(rng, startMs, counts.PAGE_RENDER, batchSize);
    // Composite cell 7: search-service × INFO
    yield* phaseSearchMiss(rng, startMs, counts.SEARCH_MISS, batchSize);
    yield* phaseIndexing(rng, startMs, counts.INDEXING, batchSize);
    // Single-pattern cells
    yield* phaseAnalytics(rng, startMs, counts.ANALYTICS, batchSize);
    yield* phaseCatalog(rng, startMs, counts.CATALOG_LOOKUP, batchSize);
    yield* phaseBackgroundVaried(
      rng,
      startMs,
      counts.BACKGROUND_VARIED,
      batchSize,
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

function* phaseHeartbeat(
  rng: Rng,
  startMs: number,
  count: number,
  batchSize: number,
): Iterable<ScenarioBatch> {
  const buf: LogRow[] = [];
  const services = [
    'inventory-service',
    'pricing-service',
    'shipping-service',
    'recommendation-service',
  ];
  for (let i = 0; i < count; i++) {
    const t = spread(i, count, startMs);
    const svc = services[i % services.length];
    const tmpl = heartbeatLog({ rng, nowMs: t, serviceName: svc });
    buf.push(
      makeLog({
        timestampMs: t,
        serviceName: svc,
        severityText: 'DEBUG',
        body: tmpl.body,
        resourceAttributes: buildResourceAttrs({ rng, serviceName: svc }),
        logAttributes: tmpl.attrs,
      }),
    );
    if (buf.length >= batchSize) {
      yield { traces: [], logs: buf.splice(0, buf.length) };
    }
  }
  if (buf.length) yield { traces: [], logs: buf };
}

function* phaseServiceOps(
  rng: Rng,
  startMs: number,
  count: number,
  batchSize: number,
): Iterable<ScenarioBatch> {
  const buf: LogRow[] = [];
  const services = [
    'inventory-service',
    'pricing-service',
    'shipping-service',
    'recommendation-service',
  ] as const;
  for (let i = 0; i < count; i++) {
    const t = spread(i, count, startMs);
    const svc = services[i % services.length];
    const tmpl = serviceOpsDebugLog({ rng, nowMs: t, serviceName: svc });
    buf.push(
      makeLog({
        timestampMs: t,
        serviceName: svc,
        severityText: 'DEBUG',
        body: tmpl.body,
        resourceAttributes: buildResourceAttrs({ rng, serviceName: svc }),
        logAttributes: tmpl.attrs,
      }),
    );
    if (buf.length >= batchSize) {
      yield { traces: [], logs: buf.splice(0, buf.length) };
    }
  }
  if (buf.length) yield { traces: [], logs: buf };
}

function* phaseCacheHit(
  rng: Rng,
  startMs: number,
  count: number,
  batchSize: number,
): Iterable<ScenarioBatch> {
  const buf: LogRow[] = [];
  for (let i = 0; i < count; i++) {
    const t = spread(i, count, startMs);
    const tmpl = cacheHitLog({ rng, nowMs: t });
    buf.push(
      makeLog({
        timestampMs: t,
        serviceName: 'notification-service',
        severityText: 'DEBUG',
        body: tmpl.body,
        resourceAttributes: buildResourceAttrs({
          rng,
          serviceName: 'notification-service',
        }),
        logAttributes: tmpl.attrs,
      }),
    );
    if (buf.length >= batchSize) {
      yield { traces: [], logs: buf.splice(0, buf.length) };
    }
  }
  if (buf.length) yield { traces: [], logs: buf };
}

function* phaseNotificationDelivery(
  rng: Rng,
  startMs: number,
  count: number,
  batchSize: number,
): Iterable<ScenarioBatch> {
  const buf: LogRow[] = [];
  for (let i = 0; i < count; i++) {
    const t = spread(i, count, startMs);
    const tmpl = notificationDeliveryLog({ rng, nowMs: t });
    buf.push(
      makeLog({
        timestampMs: t,
        serviceName: 'notification-service',
        severityText: 'DEBUG',
        body: tmpl.body,
        resourceAttributes: buildResourceAttrs({
          rng,
          serviceName: 'notification-service',
        }),
        logAttributes: tmpl.attrs,
      }),
    );
    if (buf.length >= batchSize) {
      yield { traces: [], logs: buf.splice(0, buf.length) };
    }
  }
  if (buf.length) yield { traces: [], logs: buf };
}

function* phaseStacktrace(
  rng: Rng,
  startMs: number,
  count: number,
  batchSize: number,
): Iterable<ScenarioBatch> {
  const buf: LogRow[] = [];
  for (let i = 0; i < count; i++) {
    const t = spread(i, count, startMs);
    const tmpl = caughtExceptionLog({ rng, nowMs: t });
    buf.push(
      makeLog({
        timestampMs: t,
        serviceName: 'worker',
        severityText: 'ERROR',
        body: tmpl.body,
        resourceAttributes: buildResourceAttrs({ rng, serviceName: 'worker' }),
        logAttributes: tmpl.attrs,
      }),
    );
    if (buf.length >= batchSize) {
      yield { traces: [], logs: buf.splice(0, buf.length) };
    }
  }
  if (buf.length) yield { traces: [], logs: buf };
}

function* phaseJobFailed(
  rng: Rng,
  startMs: number,
  count: number,
  batchSize: number,
): Iterable<ScenarioBatch> {
  const buf: LogRow[] = [];
  for (let i = 0; i < count; i++) {
    const t = spread(i, count, startMs);
    const tmpl = jobFailedPermanentLog({ rng, nowMs: t });
    buf.push(
      makeLog({
        timestampMs: t,
        serviceName: 'worker',
        severityText: 'ERROR',
        body: tmpl.body,
        resourceAttributes: buildResourceAttrs({ rng, serviceName: 'worker' }),
        logAttributes: tmpl.attrs,
      }),
    );
    if (buf.length >= batchSize) {
      yield { traces: [], logs: buf.splice(0, buf.length) };
    }
  }
  if (buf.length) yield { traces: [], logs: buf };
}

function* phaseSubscription(
  rng: Rng,
  startMs: number,
  count: number,
  batchSize: number,
): Iterable<ScenarioBatch> {
  const buf: LogRow[] = [];
  for (let i = 0; i < count; i++) {
    const t = spread(i, count, startMs);
    const tmpl = subscriptionMetricLog({ rng, nowMs: t });
    buf.push(
      makeLog({
        timestampMs: t,
        serviceName: 'billing-service',
        severityText: 'INFO',
        body: tmpl.body,
        resourceAttributes: buildResourceAttrs({
          rng,
          serviceName: 'billing-service',
        }),
        logAttributes: tmpl.attrs,
      }),
    );
    if (buf.length >= batchSize) {
      yield { traces: [], logs: buf.splice(0, buf.length) };
    }
  }
  if (buf.length) yield { traces: [], logs: buf };
}

function* phaseBillingEvents(
  rng: Rng,
  startMs: number,
  count: number,
  batchSize: number,
): Iterable<ScenarioBatch> {
  const buf: LogRow[] = [];
  for (let i = 0; i < count; i++) {
    const t = spread(i, count, startMs);
    const tmpl = billingEventLog({ rng, nowMs: t });
    buf.push(
      makeLog({
        timestampMs: t,
        serviceName: 'billing-service',
        severityText: 'INFO',
        body: tmpl.body,
        resourceAttributes: buildResourceAttrs({
          rng,
          serviceName: 'billing-service',
        }),
        logAttributes: tmpl.attrs,
      }),
    );
    if (buf.length >= batchSize) {
      yield { traces: [], logs: buf.splice(0, buf.length) };
    }
  }
  if (buf.length) yield { traces: [], logs: buf };
}

function* phaseAccessLog(
  rng: Rng,
  startMs: number,
  count: number,
  batchSize: number,
): Iterable<ScenarioBatch> {
  const buf: LogRow[] = [];
  for (let i = 0; i < count; i++) {
    const t = spread(i, count, startMs);
    const tmpl = envoyAccessLog({ rng, nowMs: t });
    const sev = pickSeverityIn(rng, 'info');
    buf.push(
      makeLog({
        timestampMs: t,
        serviceName: 'frontend-proxy',
        severityText: 'INFO',
        body: tmpl.body,
        resourceAttributes: buildResourceAttrs({
          rng,
          serviceName: 'frontend-proxy',
        }),
        logAttributes: { ...tmpl.attrs, _severity_raw: sev.text },
      }),
    );
    if (buf.length >= batchSize) {
      yield { traces: [], logs: buf.splice(0, buf.length) };
    }
  }
  if (buf.length) yield { traces: [], logs: buf };
}

function* phaseLbProbe(
  rng: Rng,
  startMs: number,
  count: number,
  batchSize: number,
): Iterable<ScenarioBatch> {
  const buf: LogRow[] = [];
  for (let i = 0; i < count; i++) {
    const t = spread(i, count, startMs);
    const tmpl = upstreamHealthProbeLog({ rng, nowMs: t });
    buf.push(
      makeLog({
        timestampMs: t,
        serviceName: 'frontend-proxy',
        severityText: 'INFO',
        body: tmpl.body,
        resourceAttributes: buildResourceAttrs({
          rng,
          serviceName: 'frontend-proxy',
        }),
        logAttributes: tmpl.attrs,
      }),
    );
    if (buf.length >= batchSize) {
      yield { traces: [], logs: buf.splice(0, buf.length) };
    }
  }
  if (buf.length) yield { traces: [], logs: buf };
}

function* phasePageRender(
  rng: Rng,
  startMs: number,
  count: number,
  batchSize: number,
): Iterable<ScenarioBatch> {
  const buf: LogRow[] = [];
  for (let i = 0; i < count; i++) {
    const t = spread(i, count, startMs);
    const tmpl = pageRenderLog({ rng, nowMs: t });
    buf.push(
      makeLog({
        timestampMs: t,
        serviceName: 'frontend',
        severityText: 'INFO',
        body: tmpl.body,
        resourceAttributes: buildResourceAttrs({
          rng,
          serviceName: 'frontend',
        }),
        logAttributes: tmpl.attrs,
      }),
    );
    if (buf.length >= batchSize) {
      yield { traces: [], logs: buf.splice(0, buf.length) };
    }
  }
  if (buf.length) yield { traces: [], logs: buf };
}

function* phaseConsoleDump(
  rng: Rng,
  startMs: number,
  count: number,
  batchSize: number,
): Iterable<ScenarioBatch> {
  const buf: LogRow[] = [];
  for (let i = 0; i < count; i++) {
    const t = spread(i, count, startMs);
    const tmpl = consoleLogDumpLog({ rng, nowMs: t });
    buf.push(
      makeLog({
        timestampMs: t,
        serviceName: 'frontend',
        severityText: 'INFO',
        body: tmpl.body,
        resourceAttributes: buildResourceAttrs({
          rng,
          serviceName: 'frontend',
        }),
        logAttributes: tmpl.attrs,
      }),
    );
    if (buf.length >= batchSize) {
      yield { traces: [], logs: buf.splice(0, buf.length) };
    }
  }
  if (buf.length) yield { traces: [], logs: buf };
}

function* phaseIndexing(
  rng: Rng,
  startMs: number,
  count: number,
  batchSize: number,
): Iterable<ScenarioBatch> {
  const buf: LogRow[] = [];
  for (let i = 0; i < count; i++) {
    const t = spread(i, count, startMs);
    const tmpl = indexingLog({ rng, nowMs: t });
    buf.push(
      makeLog({
        timestampMs: t,
        serviceName: 'search-service',
        severityText: 'INFO',
        body: tmpl.body,
        resourceAttributes: buildResourceAttrs({
          rng,
          serviceName: 'search-service',
        }),
        logAttributes: tmpl.attrs,
      }),
    );
    if (buf.length >= batchSize) {
      yield { traces: [], logs: buf.splice(0, buf.length) };
    }
  }
  if (buf.length) yield { traces: [], logs: buf };
}

function* phaseSearchMiss(
  rng: Rng,
  startMs: number,
  count: number,
  batchSize: number,
): Iterable<ScenarioBatch> {
  const buf: LogRow[] = [];
  for (let i = 0; i < count; i++) {
    const t = spread(i, count, startMs);
    const tmpl = searchCacheMissVerboseLog({ rng, nowMs: t });
    buf.push(
      makeLog({
        timestampMs: t,
        serviceName: 'search-service',
        severityText: 'INFO',
        body: tmpl.body,
        resourceAttributes: buildResourceAttrs({
          rng,
          serviceName: 'search-service',
        }),
        logAttributes: tmpl.attrs,
      }),
    );
    if (buf.length >= batchSize) {
      yield { traces: [], logs: buf.splice(0, buf.length) };
    }
  }
  if (buf.length) yield { traces: [], logs: buf };
}

function* phaseAnalytics(
  rng: Rng,
  startMs: number,
  count: number,
  batchSize: number,
): Iterable<ScenarioBatch> {
  const buf: LogRow[] = [];
  for (let i = 0; i < count; i++) {
    const t = spread(i, count, startMs);
    const tmpl = analyticsEventLog({ rng, nowMs: t });
    buf.push(
      makeLog({
        timestampMs: t,
        serviceName: 'analytics-service',
        severityText: 'INFO',
        body: tmpl.body,
        resourceAttributes: buildResourceAttrs({
          rng,
          serviceName: 'analytics-service',
        }),
        logAttributes: tmpl.attrs,
      }),
    );
    if (buf.length >= batchSize) {
      yield { traces: [], logs: buf.splice(0, buf.length) };
    }
  }
  if (buf.length) yield { traces: [], logs: buf };
}

function* phaseCatalog(
  rng: Rng,
  startMs: number,
  count: number,
  batchSize: number,
): Iterable<ScenarioBatch> {
  const buf: LogRow[] = [];
  for (let i = 0; i < count; i++) {
    const t = spread(i, count, startMs);
    const sev = pickSeverityIn(rng, 'info');
    const tmpl = catalogLog({ rng, nowMs: t, level: sev.text.toLowerCase() });
    buf.push(
      makeLog({
        timestampMs: t,
        serviceName: 'product-catalog',
        severityText: 'INFO',
        body: tmpl.body,
        resourceAttributes: buildResourceAttrs({
          rng,
          serviceName: 'product-catalog',
        }),
        logAttributes: { ...tmpl.attrs, _severity_raw: sev.text },
      }),
    );
    if (buf.length >= batchSize) {
      yield { traces: [], logs: buf.splice(0, buf.length) };
    }
  }
  if (buf.length) yield { traces: [], logs: buf };
}

function* phaseBackgroundVaried(
  rng: Rng,
  startMs: number,
  count: number,
  batchSize: number,
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
    // Mostly info, with realistic warn/error sprinkle
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
        // The schema uses uppercase severityText; we encode the messy
        // raw severity in LogAttributes._severity_raw so agents can see it
        // (and have to handle case-folding to count by severity).
        severityText: sevPick.text.toUpperCase().startsWith('WARN')
          ? 'WARN'
          : sevPick.text.toUpperCase().startsWith('ERR') ||
              sevPick.text === 'fatal'
            ? 'ERROR'
            : sevPick.text.toUpperCase().startsWith('DEB')
              ? 'DEBUG'
              : sevPick.text.toUpperCase() === 'TRACE'
                ? 'TRACE'
                : 'INFO',
        body,
        resourceAttributes: buildResourceAttrs({ rng, serviceName: svc }),
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

// Keep these unused imports tidy for the linter (they're conditionally
// referenced via dynamic phase functions above).
void emitBatched;
void pickSeverity;
