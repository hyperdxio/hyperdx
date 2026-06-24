import { makeLog } from '@/generators/logs';
import {
  analyticsEventLog,
  backgroundLog,
  buildResourcePool,
  catalogLog,
  envoyAccessLog,
  heartbeatLog,
  normalizeSeverityText,
  pageRenderLog,
  pickResource,
  pickSeverityIn,
  spreadTimestamp,
  uuidv4,
} from '@/generators/templates';
import { makeSpan, msToNs, newSpanId, newTraceId } from '@/generators/traces';
import type { LogRow, TraceRow } from '@/generators/types';
import type {
  GenerateContext,
  Scenario,
  ScenarioBatch,
} from '@/scenarios/types';

import groundTruth from './ground-truth.json';

const BACKGROUND_SERVICES = [
  'checkout-api',
  'payment-service',
  'cart-service',
  'inventory-service',
  'notification-service',
  'search-service',
  'recommendation-service',
  'frontend',
  'api-gateway',
  'database',
  'auth-service',
  'billing-service',
  'analytics-service',
  'image-service',
  'cdn',
  'session-service',
  'pricing-service',
  'review-service',
  'shipping-service',
  'tax-service',
  'email-service',
  'feature-flags',
  'rum-collector',
  'webhook-relay',
  'metrics-pipeline',
] as const;

const REGIONS = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-south-1'] as const;

const BACKGROUND_OPS: Record<string, string[]> = {
  'checkout-api': ['POST /api/checkout', 'GET /api/cart', 'GET /api/order'],
  'payment-service': ['payment.charge', 'payment.refund', 'payment.lookup'],
  'cart-service': ['cart.add', 'cart.list', 'cart.remove'],
  'inventory-service': ['inventory.check', 'inventory.reserve'],
  'notification-service': ['notify.email', 'notify.sms', 'notify.push'],
  'search-service': ['search.autocomplete', 'search.click'],
  'recommendation-service': ['rec.compute', 'rec.fetch'],
  frontend: ['GET /home', 'GET /product', 'GET /checkout', 'GET /account'],
  'api-gateway': ['route.dispatch', 'route.auth'],
  database: ['database.query', 'database.tx'],
  'auth-service': ['auth.login', 'auth.refresh', 'auth.verify'],
  'billing-service': ['billing.invoice', 'billing.subscription'],
  'analytics-service': ['analytics.event', 'analytics.batch'],
  'image-service': ['image.resize', 'image.fetch'],
  cdn: ['cdn.purge', 'cdn.fetch'],
  'session-service': ['session.create', 'session.validate', 'session.expire'],
  'pricing-service': ['pricing.compute', 'pricing.lookup'],
  'review-service': ['review.list', 'review.create'],
  'shipping-service': ['shipping.quote', 'shipping.track'],
  'tax-service': ['tax.compute'],
  'email-service': ['email.send', 'email.queue'],
  'feature-flags': ['flag.evaluate', 'flag.list'],
  'rum-collector': ['rum.ingest'],
  'webhook-relay': ['webhook.dispatch', 'webhook.retry'],
  'metrics-pipeline': ['metrics.ingest', 'metrics.flush'],
};

// v6 — 6M base background traces (~12M+ spans w/ child) + 12M logs.
// FAILING_TRACE_COUNT is intentionally low so a naive
// `WHERE StatusCode='ERROR'` query returns the planted failures as a small
// minority of the total recent error count (most of which is decoy traffic).
const BACKGROUND_TRACE_COUNT = 6_000_000;
const BACKGROUND_LOG_COUNT = 12_000_000;
const FAILING_TRACE_COUNT = 8;

const ANOMALY_WINDOW_MS = 5 * 60 * 1000; // last 5 min
const HISTORY_WINDOW_MS = 60 * 60 * 1000;

const TLS_SPIKE_OFFSET_FROM_NOW_MS = 25 * 60 * 1000; // T-25min
const TLS_SPIKE_DURATION_MS = 5 * 60 * 1000;
const TLS_SPIKE_COUNT = 50;

const AUTH_RATE_LIMIT_OFFSET_FROM_NOW_MS = 40 * 60 * 1000; // T-40min
const AUTH_RATE_LIMIT_DURATION_MS = 2 * 60 * 1000;
const AUTH_RATE_LIMIT_COUNT = 20;

const SEARCH_SLOW_COUNT = 80;

// Background "operational" payment.charge errors throughout the hour — these
// are NOT the planted infra incident. The decline reasons rotate so an agent
// blanket-grepping payment-service errors will get a noisy result that mixes
// legitimate user-level failures with the actual root cause.
const BACKGROUND_PAYMENT_ERROR_COUNT = 200;
const PAYMENT_DECLINE_REASONS = [
  'card declined',
  'insufficient funds',
  'CVV mismatch',
  'expired card',
  'payment method not supported',
] as const;

// Concurrent decoy: notification-service smtp errors in the SAME 5-min window
// as the planted cascade. Looks like a similar service-can't-reach-dependency
// pattern, but isn't part of any checkout-api trace — different traceids.
const SMTP_DECOY_COUNT = 25;

// Concurrent decoy: cdn origin-fetch failures in the SAME 5-min window. Same
// shape as the smtp decoy (separate trace tree, no checkout-api parent) but
// at higher count, so a status-code-only query in the recent window returns
// far more cdn rows than planted-cascade rows. Forces the agent to do
// causal/cascade analysis instead of leaning on raw error counts.
const CDN_ORIGIN_DECOY_COUNT = 80;

// Three variants of the planted timeout message — same root cause, resists
// naive exact-string matching. Counts sum to FAILING_TRACE_COUNT.
const TIMEOUT_VARIANTS = [
  { count: 3, body: 'connection timeout to db-payment' },
  { count: 3, body: 'timeout connecting to db-payment.internal' },
  { count: 2, body: 'db-payment unreachable after 5 retries' },
] as const;

type Rng = GenerateContext['rng'];

function generateTlsSpike(rng: Rng, nowMs: number): TraceRow[] {
  const traces: TraceRow[] = [];
  const startMs = nowMs - TLS_SPIKE_OFFSET_FROM_NOW_MS;
  for (let i = 0; i < TLS_SPIKE_COUNT; i++) {
    const t = spreadTimestamp(
      i,
      TLS_SPIKE_COUNT,
      startMs,
      TLS_SPIKE_DURATION_MS,
      1000,
    );
    traces.push(
      makeSpan({
        rng,
        timestampMs: t,
        traceId: newTraceId(rng),
        spanId: newSpanId(rng),
        spanName: 'route.dispatch',
        spanKind: 'SPAN_KIND_SERVER',
        serviceName: 'api-gateway',
        durationNs: msToNs(rng.range(50, 300)),
        statusCode: 'STATUS_CODE_ERROR',
        statusMessage: 'tls handshake timeout: peer reset',
        spanAttributes: {
          'http.method': 'GET',
          'http.status_code': '525',
          'error.type': 'TLSHandshakeError',
          'tls.version': '1.3',
        },
      }),
    );
  }
  return traces;
}

function generateAuthRateLimitBlip(rng: Rng, nowMs: number): TraceRow[] {
  const traces: TraceRow[] = [];
  const startMs = nowMs - AUTH_RATE_LIMIT_OFFSET_FROM_NOW_MS;
  for (let i = 0; i < AUTH_RATE_LIMIT_COUNT; i++) {
    const t = spreadTimestamp(
      i,
      AUTH_RATE_LIMIT_COUNT,
      startMs,
      AUTH_RATE_LIMIT_DURATION_MS,
      1000,
    );
    traces.push(
      makeSpan({
        rng,
        timestampMs: t,
        traceId: newTraceId(rng),
        spanId: newSpanId(rng),
        spanName: 'auth.refresh',
        spanKind: 'SPAN_KIND_SERVER',
        serviceName: 'auth-service',
        durationNs: msToNs(rng.range(8, 25)),
        statusCode: 'STATUS_CODE_ERROR',
        statusMessage: 'rate limit exceeded: 1000 req/min on /v2/token',
        spanAttributes: {
          'http.method': 'POST',
          'http.status_code': '429',
          'error.type': 'RateLimitExceeded',
        },
      }),
    );
  }
  return traces;
}

function generateSearchSlowQueries(rng: Rng, nowMs: number): TraceRow[] {
  const traces: TraceRow[] = [];
  const startMs = nowMs - HISTORY_WINDOW_MS;
  // Slow but successful — distractor for latency-style queries.
  for (let i = 0; i < SEARCH_SLOW_COUNT; i++) {
    const t = spreadTimestamp(i, SEARCH_SLOW_COUNT, startMs, HISTORY_WINDOW_MS);
    traces.push(
      makeSpan({
        rng,
        timestampMs: t,
        traceId: newTraceId(rng),
        spanId: newSpanId(rng),
        spanName: 'search.query',
        spanKind: 'SPAN_KIND_SERVER',
        serviceName: 'search-service',
        durationNs: msToNs(rng.range(1500, 3000)),
        statusCode: 'STATUS_CODE_OK',
        spanAttributes: {
          'http.method': 'GET',
          'db.system': 'elasticsearch',
          'db.statement':
            "SELECT * FROM products WHERE description LIKE '%query%'",
          'search.results_count': String(rng.intRange(0, 1000)),
        },
      }),
    );
  }
  return traces;
}

function generateBackgroundPaymentErrors(rng: Rng, nowMs: number): TraceRow[] {
  const traces: TraceRow[] = [];
  const startMs = nowMs - HISTORY_WINDOW_MS;
  for (let i = 0; i < BACKGROUND_PAYMENT_ERROR_COUNT; i++) {
    const t = spreadTimestamp(
      i,
      BACKGROUND_PAYMENT_ERROR_COUNT,
      startMs,
      HISTORY_WINDOW_MS,
    );
    const reason = rng.pick(PAYMENT_DECLINE_REASONS);
    traces.push(
      makeSpan({
        rng,
        timestampMs: t,
        traceId: newTraceId(rng),
        spanId: newSpanId(rng),
        spanName: 'payment.charge',
        spanKind: 'SPAN_KIND_SERVER',
        serviceName: 'payment-service',
        durationNs: msToNs(rng.range(50, 250)),
        statusCode: 'STATUS_CODE_ERROR',
        statusMessage: reason,
        spanAttributes: {
          'rpc.system': 'grpc',
          'payment.amount_cents': String(rng.intRange(100, 50000)),
          'payment.method': rng.pick(['card', 'ach', 'wallet']),
          'error.type': 'PaymentDeclined',
          'decline.reason': reason,
        },
      }),
    );
  }
  return traces;
}

function generateSmtpDecoy(
  rng: Rng,
  nowMs: number,
): { traces: TraceRow[]; logs: LogRow[] } {
  const traces: TraceRow[] = [];
  const logs: LogRow[] = [];
  const onsetMs = nowMs - ANOMALY_WINDOW_MS;
  for (let i = 0; i < SMTP_DECOY_COUNT; i++) {
    const t = spreadTimestamp(
      i,
      SMTP_DECOY_COUNT,
      onsetMs,
      ANOMALY_WINDOW_MS,
      5_000,
    );
    const traceId = newTraceId(rng);
    const spanId = newSpanId(rng);
    traces.push(
      makeSpan({
        rng,
        timestampMs: t,
        traceId,
        spanId,
        spanName: 'notify.email',
        spanKind: 'SPAN_KIND_CLIENT',
        serviceName: 'notification-service',
        durationNs: msToNs(rng.range(800, 2000)),
        statusCode: 'STATUS_CODE_ERROR',
        statusMessage: 'smtp connection refused: smtp.internal:587',
        spanAttributes: {
          'net.peer.name': 'smtp.internal',
          'net.peer.port': '587',
          'error.type': 'SMTPConnectionError',
          'email.recipient_count': '1',
        },
      }),
    );
    logs.push(
      makeLog({
        timestampMs: t + rng.intRange(5, 30),
        serviceName: 'notification-service',
        severityText: 'ERROR',
        body: 'smtp connection refused: smtp.internal:587',
        traceId,
        spanId,
        logAttributes: {
          'error.kind': 'SMTPConnectionError',
          component: 'notification-service',
        },
      }),
    );
  }
  return { traces, logs };
}

function generateCdnOriginDecoy(
  rng: Rng,
  nowMs: number,
): { traces: TraceRow[]; logs: LogRow[] } {
  const traces: TraceRow[] = [];
  const logs: LogRow[] = [];
  const onsetMs = nowMs - ANOMALY_WINDOW_MS;
  for (let i = 0; i < CDN_ORIGIN_DECOY_COUNT; i++) {
    const t = spreadTimestamp(
      i,
      CDN_ORIGIN_DECOY_COUNT,
      onsetMs,
      ANOMALY_WINDOW_MS,
      5_000,
    );
    const traceId = newTraceId(rng);
    const spanId = newSpanId(rng);
    traces.push(
      makeSpan({
        rng,
        timestampMs: t,
        traceId,
        spanId,
        spanName: 'cdn.cache.fetch',
        spanKind: 'SPAN_KIND_CLIENT',
        serviceName: 'cdn',
        durationNs: msToNs(rng.range(150, 600)),
        statusCode: 'STATUS_CODE_ERROR',
        statusMessage: 'origin connection refused: origin-static.internal:443',
        spanAttributes: {
          'http.method': 'GET',
          'http.status_code': '502',
          'net.peer.name': 'origin-static.internal',
          'net.peer.port': '443',
          'error.type': 'OriginUnreachableError',
          'cdn.edge_pop': rng.pick([
            'edge-iad',
            'edge-sfo',
            'edge-fra',
            'edge-syd',
          ]),
        },
      }),
    );
    logs.push(
      makeLog({
        timestampMs: t + rng.intRange(5, 30),
        serviceName: 'cdn',
        severityText: 'ERROR',
        body: 'origin connection refused: origin-static.internal:443',
        traceId,
        spanId,
        logAttributes: {
          'error.kind': 'OriginUnreachableError',
          component: 'cdn',
          'origin.host': 'origin-static.internal',
        },
      }),
    );
  }
  return { traces, logs };
}

function generateAnomaly(
  rng: Rng,
  nowMs: number,
): { traces: TraceRow[]; logs: LogRow[] } {
  const traces: TraceRow[] = [];
  const logs: LogRow[] = [];
  const onsetMs = nowMs - ANOMALY_WINDOW_MS;
  const slots: { body: string }[] = [];
  for (const v of TIMEOUT_VARIANTS) {
    for (let k = 0; k < v.count; k++) slots.push({ body: v.body });
  }
  // Shuffle slots deterministically using the seeded RNG.
  for (let i = slots.length - 1; i > 0; i--) {
    const j = rng.intRange(0, i + 1);
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }

  for (let i = 0; i < FAILING_TRACE_COUNT; i++) {
    const t = spreadTimestamp(
      i,
      FAILING_TRACE_COUNT,
      onsetMs,
      ANOMALY_WINDOW_MS,
      5_000,
    );
    const traceId = newTraceId(rng);
    const variantBody = slots[i].body;

    const rootSpanId = newSpanId(rng);
    traces.push(
      makeSpan({
        rng,
        timestampMs: t,
        traceId,
        spanId: rootSpanId,
        spanName: 'POST /api/checkout',
        spanKind: 'SPAN_KIND_SERVER',
        serviceName: 'checkout-api',
        durationNs: msToNs(rng.range(2200, 3200)),
        statusCode: 'STATUS_CODE_ERROR',
        statusMessage: 'payment_service_unavailable',
        spanAttributes: {
          'http.method': 'POST',
          'http.route': '/api/checkout',
          'http.status_code': '500',
          'user.id': `user-${rng.intRange(1000, 9999)}`,
        },
      }),
    );

    const midSpanId = newSpanId(rng);
    traces.push(
      makeSpan({
        rng,
        timestampMs: t + rng.intRange(1, 5),
        traceId,
        spanId: midSpanId,
        parentSpanId: rootSpanId,
        spanName: 'payment.charge',
        spanKind: 'SPAN_KIND_CLIENT',
        serviceName: 'payment-service',
        durationNs: msToNs(rng.range(2000, 2900)),
        statusCode: 'STATUS_CODE_ERROR',
        statusMessage: 'db connection timeout',
        spanAttributes: {
          'rpc.system': 'grpc',
          'payment.amount_cents': String(rng.intRange(500, 50000)),
          'error.type': 'ConnectionTimeoutError',
        },
      }),
    );

    traces.push(
      makeSpan({
        rng,
        timestampMs: t + rng.intRange(5, 15),
        traceId,
        spanId: newSpanId(rng),
        parentSpanId: midSpanId,
        spanName: 'db.payment.connect',
        spanKind: 'SPAN_KIND_CLIENT',
        serviceName: 'payment-service',
        durationNs: msToNs(rng.range(1900, 2500)),
        statusCode: 'STATUS_CODE_ERROR',
        statusMessage: variantBody,
        spanAttributes: {
          'db.system': 'postgres',
          'db.name': 'payments',
          'db.statement': 'SELECT 1',
          'net.peer.name': 'db-payment.internal',
          'error.type': 'ConnectionTimeoutError',
        },
      }),
    );

    logs.push(
      makeLog({
        timestampMs: t + rng.intRange(10, 50),
        serviceName: 'payment-service',
        severityText: 'ERROR',
        body: `${variantBody} (trace_id=${traceId})`,
        traceId,
        spanId: midSpanId,
        logAttributes: {
          'error.kind': 'DBTimeout',
          component: 'payment-service',
          'db.host': 'db-payment.internal',
        },
      }),
    );
  }
  return { traces, logs };
}

export const errorRootCauseScenario: Scenario = {
  name: 'error-root-cause',
  agentPrompt: groundTruth.agentPrompt,
  description:
    'payment-service DB connection timeout cascading into checkout-api 5xx, buried in 12M+ background spans + 12M templated log bodies + 5 distractor anomalies',
  *generate(ctx): Iterable<ScenarioBatch> {
    const factor = ctx.volumeFactor ?? 1;
    const batchSize = ctx.batchSize ?? 10_000;
    const bgTraceCount = Math.max(
      50,
      Math.round(BACKGROUND_TRACE_COUNT * factor),
    );
    const bgLogCount = Math.max(50, Math.round(BACKGROUND_LOG_COUNT * factor));

    const resourcePool = buildResourcePool({
      rng: ctx.rng,
      services: BACKGROUND_SERVICES,
      instancesPerService: 16,
    });

    yield* streamBackground(
      ctx.rng,
      ctx.nowMs,
      bgTraceCount,
      bgLogCount,
      batchSize,
      resourcePool,
    );

    // Distractors and the planted anomaly stay at fixed counts so the
    // structural invariants remain identical regardless of volumeFactor.
    const tls = generateTlsSpike(ctx.rng, ctx.nowMs);
    const auth = generateAuthRateLimitBlip(ctx.rng, ctx.nowMs);
    const slow = generateSearchSlowQueries(ctx.rng, ctx.nowMs);
    const bgPayment = generateBackgroundPaymentErrors(ctx.rng, ctx.nowMs);
    const smtp = generateSmtpDecoy(ctx.rng, ctx.nowMs);
    const cdn = generateCdnOriginDecoy(ctx.rng, ctx.nowMs);
    const anomaly = generateAnomaly(ctx.rng, ctx.nowMs);
    yield {
      traces: [
        ...tls,
        ...auth,
        ...slow,
        ...bgPayment,
        ...smtp.traces,
        ...cdn.traces,
        ...anomaly.traces,
      ],
      logs: [...smtp.logs, ...cdn.logs, ...anomaly.logs],
    };
  },
  groundTruth,
};

type LogTemplateKind =
  | 'page_render'
  | 'envoy_access'
  | 'analytics'
  | 'catalog'
  | 'heartbeat'
  | 'background';

const LOG_TEMPLATE_MIX: { value: LogTemplateKind; weight: number }[] = [
  { value: 'page_render', weight: 25 },
  { value: 'envoy_access', weight: 15 },
  { value: 'analytics', weight: 15 },
  { value: 'catalog', weight: 15 },
  { value: 'heartbeat', weight: 10 },
  { value: 'background', weight: 20 },
];

const LOG_TEMPLATE_SERVICE: Record<LogTemplateKind, string> = {
  page_render: 'frontend',
  envoy_access: 'api-gateway',
  analytics: 'analytics-service',
  catalog: 'image-service',
  heartbeat: 'inventory-service',
  background: 'session-service',
};

function* streamBackground(
  rng: Rng,
  nowMs: number,
  traceCount: number,
  logCount: number,
  batchSize: number,
  resourcePool: Record<string, Record<string, string>[]>,
) {
  const bufTraces: TraceRow[] = [];
  const bufLogs: LogRow[] = [];
  const startMs = nowMs - HISTORY_WINDOW_MS;

  for (let i = 0; i < traceCount; i++) {
    const t = spreadTimestamp(
      i,
      traceCount,
      startMs,
      HISTORY_WINDOW_MS,
      60_000,
    );
    const traceId = newTraceId(rng);
    const parentService = rng.pick(BACKGROUND_SERVICES);
    const parentOp = rng.pick(BACKGROUND_OPS[parentService]);
    const parentSpanId = newSpanId(rng);
    const isError = parentService !== 'payment-service' && rng.next() < 0.005;
    const region = rng.pick(REGIONS);
    const tenantId = `tenant-${rng.intRange(1, 5000)}`;
    const requestId = uuidv4(rng);
    const userId = `u${rng.intRange(1, 5_000_000)}`;
    const sessionId = uuidv4(rng);
    bufTraces.push(
      makeSpan({
        rng,
        timestampMs: t,
        traceId,
        spanId: parentSpanId,
        spanName: parentOp,
        spanKind: 'SPAN_KIND_SERVER',
        serviceName: parentService,
        durationNs: msToNs(rng.range(15, 200)),
        statusCode: isError ? 'STATUS_CODE_ERROR' : 'STATUS_CODE_OK',
        resourceAttributes: pickResource(rng, resourcePool, parentService),
        spanAttributes: {
          'http.method': 'GET',
          'http.status_code': isError ? '500' : '200',
          'http.route': `/internal/${parentOp.replace(/[^a-z0-9]+/gi, '/')}`,
          'cloud.region': region,
          'tenant.id': tenantId,
          'user.id': userId,
          'session.id': sessionId,
          'request.id': requestId,
          'rpc.system': 'http',
        },
      }),
    );
    if (rng.next() < 0.6) {
      const candidates = BACKGROUND_SERVICES.filter(s => s !== parentService);
      const childService = rng.pick(candidates);
      const childOp = rng.pick(BACKGROUND_OPS[childService]);
      bufTraces.push(
        makeSpan({
          rng,
          timestampMs: t + rng.intRange(1, 10),
          traceId,
          spanId: newSpanId(rng),
          parentSpanId,
          spanName: childOp,
          spanKind: 'SPAN_KIND_CLIENT',
          serviceName: childService,
          durationNs: msToNs(rng.range(5, 80)),
          statusCode: 'STATUS_CODE_OK',
          resourceAttributes: pickResource(rng, resourcePool, childService),
          spanAttributes: {
            'rpc.system': 'http',
            'cloud.region': region,
            'request.id': requestId,
            'user.id': userId,
            'net.peer.name': `${childService}.svc.cluster.local`,
          },
        }),
      );
    }
    if (bufTraces.length >= batchSize) {
      yield { traces: bufTraces.splice(0, bufTraces.length), logs: [] };
    }
  }
  if (bufTraces.length) {
    yield { traces: bufTraces.splice(0, bufTraces.length), logs: [] };
  }

  for (let i = 0; i < logCount; i++) {
    const t = spreadTimestamp(i, logCount, startMs, HISTORY_WINDOW_MS, 60_000);
    const kind = rng.weightedPick(LOG_TEMPLATE_MIX);
    const service = LOG_TEMPLATE_SERVICE[kind];
    const sev = pickSeverityIn(
      rng,
      kind === 'heartbeat'
        ? 'debug'
        : rng.weightedPick<'info' | 'warn' | 'error'>([
            { value: 'info', weight: 88 },
            { value: 'warn', weight: 9 },
            { value: 'error', weight: 3 },
          ]),
    );
    let body: string;
    let attrs: Record<string, string>;
    if (kind === 'page_render') {
      const tmpl = pageRenderLog({ rng, nowMs: t });
      body = tmpl.body;
      attrs = tmpl.attrs;
    } else if (kind === 'envoy_access') {
      const tmpl = envoyAccessLog({ rng, nowMs: t });
      body = tmpl.body;
      attrs = tmpl.attrs;
    } else if (kind === 'analytics') {
      const tmpl = analyticsEventLog({ rng, nowMs: t });
      body = tmpl.body;
      attrs = tmpl.attrs;
    } else if (kind === 'catalog') {
      const tmpl = catalogLog({ rng, nowMs: t, level: sev.text.toLowerCase() });
      body = tmpl.body;
      attrs = tmpl.attrs;
    } else if (kind === 'heartbeat') {
      const tmpl = heartbeatLog({ rng, nowMs: t, serviceName: service });
      body = tmpl.body;
      attrs = tmpl.attrs;
    } else {
      body = backgroundLog({ rng, nowMs: t });
      attrs = {
        'event.name': 'app.background',
        'log.iostream': 'stdout',
        logtag: 'F',
      };
    }
    bufLogs.push(
      makeLog({
        timestampMs: t,
        serviceName: service,
        severityText: normalizeSeverityText(sev.text),
        body,
        resourceAttributes: pickResource(rng, resourcePool, service),
        logAttributes: { ...attrs, _severity_raw: sev.text },
      }),
    );
    if (bufLogs.length >= batchSize) {
      yield { traces: [], logs: bufLogs.splice(0, bufLogs.length) };
    }
  }
  if (bufLogs.length) yield { traces: [], logs: bufLogs };
}
