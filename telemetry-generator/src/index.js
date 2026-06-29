/*
 * Telemetry generator — synthetic OTLP traces + coherent metric exemplars.
 *
 * Why this exists: hand-seeding ClickHouse produces incoherent data (metric
 * values, exemplar values, and the traces they point at don't agree). This
 * service emits realistic traces over OTLP (diverse attributes, failure
 * scenarios, nested service spans, backfill + live) and, for each request,
 * writes ONE metric data point whose value AND exemplar are derived from that
 * exact trace — so the metric line, the exemplar markers, the hover metadata,
 * and the linked trace all agree by construction.
 *
 * Traces go through the real OTLP pipeline (collector -> ClickHouse). Metric
 * exemplars are written to ClickHouse directly because OTel JS (1.30) does not
 * yet emit metric exemplars and our collector has no spanmetrics connector.
 * See README for the spanmetrics upgrade path.
 */
'use strict';

const {
  trace,
  ROOT_CONTEXT,
  SpanStatusCode,
  SpanKind,
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
} = require('@opentelemetry/api');
// Surface OTLP export failures (auth, connection) instead of dropping silently.
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const {
  OTLPTraceExporter,
} = require('@opentelemetry/exporter-trace-otlp-proto');
const { Resource } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');
const net = require('net');

// ── Config ──────────────────────────────────────────────────────────
const cfg = {
  // OTLP HTTP base (port 4318). Traces are POSTed to <base>/v1/traces.
  otlpEndpoint:
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://otel-collector:4318',
  backfillMinutes: Number(process.env.GEN_BACKFILL_MINUTES || 30),
  ratePerSec: Number(process.env.GEN_RATE_PER_SEC || 20),
  // HyperDX collectors enforce bearer-token auth on OTLP ingest. Default to the
  // dev INGESTION_API_KEY (packages/api/.env.development); override per env.
  otlpApiKey:
    process.env.GEN_OTLP_API_KEY || 'super-secure-ingestion-api-key',
};

// ── Weighted / uniform random helpers ───────────────────────────────
function pickWeighted(choices) {
  const total = choices.reduce((s, c) => s + c[1], 0);
  let r = Math.random() * total;
  for (const [value, weight] of choices) {
    r -= weight;
    if (r <= 0) return value;
  }
  return choices[choices.length - 1][0];
}
function pickUniform(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
// Box-Muller gaussian, clamped to >= 1ms
function gaussianMs(mean, stddev) {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(1, mean + z * stddev);
}

// ── Attribute pools (cardinality + diversity) ───────────────────────
const routes = [
  ['/api/users', 25],
  ['/api/orders', 15],
  ['/cart/checkout', 10],
  ['/api/search', 25],
  ['/api/products', 15],
  ['/api/auth', 10],
];
const methods = [
  ['GET', 60],
  ['POST', 25],
  ['PUT', 10],
  ['DELETE', 5],
];
const regions = [
  ['us-east-1', 40],
  ['us-west-2', 30],
  ['eu-west-1', 20],
  ['ap-southeast-1', 10],
];
const buildIDs = [
  ['build-7a1', 35],
  ['build-7a2', 35],
  ['build-7a3', 30],
];
const platforms = [
  ['web', 50],
  ['ios', 30],
  ['android', 20],
];
const featureFlags = [
  ['new-checkout-flow', 15],
  ['dark-launch-search', 10],
  ['legacy', 75],
];
const tenants = [
  'tenant-acme',
  'tenant-globex',
  'tenant-initech',
  'tenant-umbrella',
];
const pods = Array.from({ length: 8 }, (_, i) => `pod-abc-${i + 1}`);
const userId = () => `user-${String(Math.floor(Math.random() * 500) + 1).padStart(4, '0')}`;

function routeToService(route) {
  switch (route) {
    case '/api/orders':
    case '/cart/checkout':
      return 'order-service';
    case '/api/users':
    case '/api/auth':
      return 'user-service';
    case '/api/search':
    case '/api/products':
      return 'search-service';
    default:
      return 'unknown-service';
  }
}
function serviceToDb(svc) {
  if (svc === 'order-service' || svc === 'user-service') return 'postgres';
  if (svc === 'search-service') return 'elasticsearch';
  return 'none';
}

// ── Per-service tracer providers (ServiceName = resource attr) ───────
const SERVICE_NAMES = [
  'api-gateway',
  'order-service',
  'user-service',
  'search-service',
  'payment-service',
  'notification-service',
];
const exporter = new OTLPTraceExporter({
  url: `${cfg.otlpEndpoint.replace(/\/$/, '')}/v1/traces`,
  // HyperDX's bearertokenauth uses scheme:'' — send the raw token, no prefix.
  headers: cfg.otlpApiKey ? { authorization: cfg.otlpApiKey } : undefined,
});
const providers = new Map();
const tracers = new Map();
for (const name of SERVICE_NAMES) {
  const provider = new NodeTracerProvider({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: name,
      'service.version': '1.0.0',
    }),
    spanProcessors: [
      // Large queue so the backfill burst isn't dropped before export.
      new BatchSpanProcessor(exporter, {
        maxExportBatchSize: 512,
        maxQueueSize: 32768,
        scheduledDelayMillis: 500,
      }),
    ],
  });
  providers.set(name, provider);
  tracers.set(name, provider.getTracer('telemetry-generator'));
}
const tracer = name => tracers.get(name);

const jitter = () => Math.random() * 2; // ms

function commonAttrs(a) {
  return {
    'http.method': a.method,
    'http.route': a.route,
    'user.id': a.uid,
    'app.tenant_id': a.tenant,
    'host.region': a.region,
    'app.build_id': a.buildID,
    'app.platform': a.platform,
    'app.feature_flag': a.featureFlag,
    'k8s.pod.name': a.pod,
  };
}
function markError(span, type, message) {
  span.setStatus({ code: SpanStatusCode.ERROR, message });
  span.addEvent('exception', {
    'exception.type': type,
    'exception.message': message,
  });
}

// ── Trace emission ──────────────────────────────────────────────────
// Emits a trace; the collector's spanmetrics connector derives the
// request-duration metric (with exemplars) from these spans.
function emitTrace(tsMs) {
  const a = {
    route: pickWeighted(routes),
    method: pickWeighted(methods),
    region: pickWeighted(regions),
    buildID: pickWeighted(buildIDs),
    platform: pickWeighted(platforms),
    featureFlag: pickWeighted(featureFlags),
    tenant: pickUniform(tenants),
    uid: userId(),
    pod: pickUniform(pods),
  };
  const svc = routeToService(a.route);
  const sc = detectScenario(a);
  const plan = SCENARIOS[sc](a, svc);

  const root = tracer('api-gateway').startSpan(
    `${a.method} ${a.route}`,
    {
      kind: SpanKind.SERVER,
      startTime: tsMs,
      attributes: { ...commonAttrs(a), 'http.status_code': plan.statusCode },
    },
    ROOT_CONTEXT,
  );
  if (plan.error) markError(root, plan.error.type, plan.error.message);
  else root.setStatus({ code: SpanStatusCode.OK });

  const rootCtx = trace.setSpan(ROOT_CONTEXT, root);
  const svcStart = tsMs + jitter();
  const svcSpan = tracer(svc).startSpan(
    `${svc}.handle`,
    { kind: SpanKind.INTERNAL, startTime: svcStart, attributes: svcAttrs(svc, a) },
    rootCtx,
  );
  if (plan.error) markError(svcSpan, plan.error.type, plan.error.message);
  const svcCtx = trace.setSpan(rootCtx, svcSpan);

  // Leaf spans (db / cache / downstream) per the scenario plan.
  let cursor = svcStart + jitter();
  for (const leaf of plan.leaves) {
    const leafSvc = leaf.service || svc;
    const ls = tracer(leafSvc).startSpan(
      leaf.name,
      {
        kind: SpanKind.CLIENT,
        startTime: cursor,
        attributes: {
          [ATTR_SERVICE_NAME]: leafSvc,
          'host.region': a.region,
          ...(leaf.attrs || {}),
        },
      },
      svcCtx,
    );
    if (leaf.error) markError(ls, leaf.error.type, leaf.error.message);
    ls.end(cursor + leaf.durMs);
    cursor += leaf.durMs + 1;
  }

  svcSpan.end(svcStart + plan.svcDurMs);
  root.end(tsMs + plan.rootDurMs);
}

function svcAttrs(svc, a) {
  return {
    [ATTR_SERVICE_NAME]: svc,
    'http.route': a.route,
    'host.region': a.region,
    'app.build_id': a.buildID,
    'app.feature_flag': a.featureFlag,
    'app.platform': a.platform,
    'user.id': a.uid,
    'app.tenant_id': a.tenant,
    'k8s.pod.name': a.pod,
  };
}

// ── Scenarios ───────────────────────────────────────────────────────
// Each returns { rootDurMs, svcDurMs, statusCode, error?, leaves:[{name,durMs,service?,attrs?,error?}] }
const PAYMENT_TIMEOUT_RATE = 0.05;
const AUTH_LEAK_ERROR_RATE = 0.1;

function detectScenario(a) {
  const svc = routeToService(a.route);
  if (
    a.route === '/cart/checkout' &&
    a.region === 'us-west-2' &&
    Math.random() < PAYMENT_TIMEOUT_RATE
  )
    return 'paymentTimeout';
  if (
    a.route === '/cart/checkout' &&
    a.featureFlag === 'new-checkout-flow' &&
    a.region === 'eu-west-1'
  )
    return 'slowCheckout';
  if (a.route === '/api/orders' && a.platform === 'ios' && a.buildID === 'build-7a3')
    return 'iosOrderErrors';
  if (
    a.tenant === 'tenant-initech' &&
    a.featureFlag === 'dark-launch-search' &&
    a.route === '/api/search'
  )
    return 'initechSearch';
  if (
    a.route === '/api/auth' &&
    a.buildID === 'build-7a3' &&
    (a.pod === 'pod-abc-7' || a.pod === 'pod-abc-8')
  )
    return 'authMemoryLeak';
  if (a.region === 'ap-southeast-1' && svc === 'user-service')
    return 'redisTimeoutApac';
  if (a.tenant === 'tenant-umbrella' && a.region === 'eu-west-1')
    return 'umbrellaCompliance';
  return 'normal';
}

function normalStatus() {
  const r = Math.random();
  if (r < 0.95) return 200;
  if (r < 0.98) return 201;
  return 404;
}

const SCENARIOS = {
  normal: (a, svc) => {
    const db = serviceToDb(svc);
    const leaves = [];
    if (db === 'postgres')
      leaves.push({
        name: 'postgres.query',
        durMs: gaussianMs(10, 5),
        attrs: { 'db.system': 'postgres', 'db.statement': `SELECT * FROM ${a.route.slice(5)}` },
      });
    else if (db === 'elasticsearch')
      leaves.push({
        name: 'elasticsearch.search',
        durMs: gaussianMs(10, 5),
        attrs: { 'db.system': 'elasticsearch' },
      });
    if (a.route === '/cart/checkout')
      leaves.push({
        name: 'payment-service.charge',
        service: 'payment-service',
        durMs: gaussianMs(10, 4),
      });
    return { rootDurMs: gaussianMs(40, 20), svcDurMs: gaussianMs(25, 12), statusCode: normalStatus(), leaves };
  },
  slowCheckout: a => {
    const leaves = [];
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++)
      leaves.push({
        name: 'postgres.query',
        durMs: gaussianMs(200, 40),
        attrs: { 'db.system': 'postgres', 'db.statement': 'SELECT * FROM orders WHERE id = ?' },
      });
    leaves.push({ name: 'payment-service.charge', service: 'payment-service', durMs: gaussianMs(200, 50) });
    return { rootDurMs: gaussianMs(1500, 400), svcDurMs: gaussianMs(1200, 350), statusCode: 200, leaves };
  },
  iosOrderErrors: () => ({
    rootDurMs: gaussianMs(250, 60),
    svcDurMs: gaussianMs(100, 30),
    statusCode: 500,
    error: { type: 'ValidationError', message: 'malformed request body' },
    leaves: [],
  }),
  redisTimeoutApac: a => ({
    rootDurMs: gaussianMs(650, 120),
    svcDurMs: gaussianMs(580, 100),
    statusCode: 200,
    leaves: [
      { name: 'redis.get', durMs: gaussianMs(550, 100), attrs: { 'db.system': 'redis', 'db.statement': `GET user:session:${a.uid}` } },
      { name: 'postgres.query', durMs: gaussianMs(30, 10), attrs: { 'db.system': 'postgres' } },
    ],
  }),
  initechSearch: () => ({
    rootDurMs: gaussianMs(3000, 500),
    svcDurMs: gaussianMs(2800, 450),
    statusCode: 500,
    error: { type: 'TimeoutError', message: 'elasticsearch timeout' },
    leaves: [
      {
        name: 'elasticsearch.search',
        durMs: gaussianMs(2500, 400),
        attrs: { 'db.system': 'elasticsearch' },
        error: { type: 'IOException', message: 'read tcp: i/o timeout' },
      },
    ],
  }),
  authMemoryLeak: a => {
    const err = Math.random() < AUTH_LEAK_ERROR_RATE;
    return {
      rootDurMs: gaussianMs(800, 200),
      svcDurMs: gaussianMs(700, 180),
      statusCode: err ? 503 : 200,
      error: err ? { type: 'ServiceUnavailableError', message: 'GC overhead' } : undefined,
      leaves: [{ name: 'redis.get', durMs: gaussianMs(600, 150), attrs: { 'db.system': 'redis', 'db.statement': `GET auth:token:${a.uid}` } }],
    };
  },
  paymentTimeout: () => ({
    rootDurMs: gaussianMs(5000, 500),
    svcDurMs: gaussianMs(4800, 450),
    statusCode: 504,
    error: { type: 'TimeoutError', message: 'gateway timeout' },
    leaves: [
      { name: 'postgres.query', durMs: gaussianMs(20, 8), attrs: { 'db.system': 'postgres' } },
      {
        name: 'payment-service.charge',
        service: 'payment-service',
        durMs: gaussianMs(4500, 300),
        error: { type: 'TimeoutError', message: 'context deadline exceeded' },
      },
    ],
  }),
  umbrellaCompliance: (a, svc) => {
    const overhead = gaussianMs(150, 40);
    const db = serviceToDb(svc);
    const leaves = [{ name: 'compliance.data_residency_check', durMs: overhead, attrs: { 'app.tenant_id': a.tenant } }];
    if (db === 'postgres') leaves.push({ name: 'postgres.query', durMs: gaussianMs(10, 5), attrs: { 'db.system': 'postgres' } });
    else if (db === 'elasticsearch') leaves.push({ name: 'elasticsearch.search', durMs: gaussianMs(10, 5), attrs: { 'db.system': 'elasticsearch' } });
    return { rootDurMs: gaussianMs(40, 20) + overhead, svcDurMs: gaussianMs(40, 20) + overhead, statusCode: normalStatus(), leaves };
  },
};

// The collector's OTLP receiver is configured dynamically via OpAMP, so the
// port isn't open the instant the container starts — it appears only after the
// collector fetches its remote config. Wait for it before backfilling, else the
// initial burst hits ECONNREFUSED and is lost.
function waitForCollector(timeoutMs = 120_000) {
  const u = new URL(cfg.otlpEndpoint);
  const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
  const host = u.hostname;
  const deadline = Date.now() + timeoutMs;
  const tryOnce = () =>
    new Promise(resolve => {
      const sock = net.connect({ host, port }, () => {
        sock.destroy();
        resolve(true);
      });
      sock.on('error', () => {
        sock.destroy();
        resolve(false);
      });
      sock.setTimeout(2000, () => {
        sock.destroy();
        resolve(false);
      });
    });
  return (async () => {
    while (Date.now() < deadline) {
      if (await tryOnce()) return true;
      await new Promise(r => setTimeout(r, 2000));
    }
    return false;
  })();
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log(
    `telemetry-generator starting: otlp=${cfg.otlpEndpoint} ` +
      `backfill=${cfg.backfillMinutes}m rate=${cfg.ratePerSec}/s`,
  );

  console.log('waiting for collector OTLP endpoint...');
  const ready = await waitForCollector();
  console.log(ready ? 'collector reachable' : 'collector wait timed out, proceeding anyway');

  // Backfill historical traces. The spanmetrics connector derives the
  // request-duration metric (with exemplars) from these spans.
  const now = Date.now();
  const backfillStart = now - cfg.backfillMinutes * 60_000;
  const backfillCount = cfg.backfillMinutes * 60 * cfg.ratePerSec;
  console.log(`backfilling ~${backfillCount} requests over ${cfg.backfillMinutes}m...`);
  for (let i = 0; i < backfillCount; i++) {
    const ts = backfillStart + Math.random() * (now - backfillStart);
    emitTrace(ts);
    // Periodically yield so the span exporter can drain its queue instead of
    // overflowing (which would drop traces, and thus their exemplars).
    if (i % 500 === 0) await new Promise(r => setTimeout(r, 25));
  }
  // Let the final span batches export before we declare backfill done.
  await new Promise(r => setTimeout(r, 3000));
  console.log('backfill complete, starting live emission...');

  // Live emission.
  const intervalMs = Math.max(1, Math.floor(1000 / cfg.ratePerSec));
  setInterval(() => emitTrace(Date.now()), intervalMs);

  const shutdown = async () => {
    console.log('shutting down...');
    await Promise.all(
      [...providers.values()].map(p => p.shutdown().catch(() => {})),
    );
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
