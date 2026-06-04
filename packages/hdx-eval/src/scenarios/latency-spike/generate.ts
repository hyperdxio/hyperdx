import {
  buildResourcePool,
  pickResource,
  spreadTimestamp,
  uuidv4,
} from '../../generators/templates';
import {
  makeSpan,
  msToNs,
  newSpanId,
  newTraceId,
} from '../../generators/traces';
import type { LogRow, TraceRow } from '../../generators/types';
import type { GenerateContext, Scenario, ScenarioBatch } from '../types';
import groundTruth from './ground-truth.json';

// v6 — 6M base traces × ~2 child spans + 4M background traces × 2 spans
// + extras → ~20M+ total spans. Background traffic plants ~100 services
// × ~15 operations each so the (ServiceName, SpanName) cardinality is
// production-shaped (~1500 distinct combos) and naive
// `GROUP BY ServiceName, SpanName` returns too many rows to scan.
const TOTAL_TRACES = 6_000_000;
const BACKGROUND_TRACES = 4_000_000;
const HISTORY_WINDOW_MS = 60 * 60 * 1000;
const ANOMALY_WINDOW_MS = 10 * 60 * 1000;

const ENDPOINTS = [
  { name: 'GET /api/orders/search', weight: 12 },
  { name: 'GET /api/orders/{id}', weight: 18 },
  { name: 'POST /api/orders', weight: 6 },
  { name: 'GET /api/products/search', weight: 10 },
  { name: 'GET /api/products/{id}', weight: 12 },
  { name: 'GET /api/inventory/{sku}', weight: 8 },
  { name: 'POST /api/cart/items', weight: 8 },
  { name: 'GET /api/cart/{id}', weight: 8 },
  { name: 'GET /api/users/{id}', weight: 6 },
  { name: 'POST /api/checkout', weight: 4 },
  { name: 'GET /api/recommendations', weight: 4 },
  { name: 'GET /api/health', weight: 4 },
];

const REGIONS = [
  'us-east-1',
  'us-west-2',
  'eu-west-1',
  'ap-south-1',
  'sa-east-1',
] as const;
const TENANT_RANGE = 5_000; // was 200

const TENANT_TIERS = [
  { value: 'free', weight: 60 },
  { value: 'pro', weight: 35 },
  { value: 'enterprise', weight: 5 },
] as const;

// Normal-traffic latency distribution. Each tuple is (lo_ms, hi_ms, weight).
const NORMAL_LATENCY_BUCKETS = [
  { lo: 25, hi: 80, weight: 65 },
  { lo: 80, hi: 180, weight: 25 },
  { lo: 180, hi: 350, weight: 8 },
  { lo: 350, hi: 600, weight: 2 },
];

// Distractors
const GC_PAUSE_RATE = 0.003; // 0.3% of all traces — uniform across tiers/endpoints
const CACHE_LOOKUP_RATE = 0.03; // 3% of traces add an extra cache.lookup child span (200-400ms)

const COLD_START_WINDOW_END_MS = 55 * 60 * 1000; // T-55min
const COLD_START_WINDOW_START_MS = 60 * 60 * 1000; // T-60min
const COLD_START_RATE_IN_WINDOW = 0.4; // 40% of traces in the early window are cold-start

// Anomaly
const ENTERPRISE_CACHE_HIT_RATE = 0.2; // 20% of enterprise window requests still fast (cache hit)

// Concurrent decoy: GET /api/products/search has its own slowness in the
// same window, all tiers, caused by an elasticsearch hot shard. Real, but
// unrelated to the orders/search × enterprise × missing-index issue.
const PRODUCTS_SEARCH_HOT_SHARD_RATE = 0.5; // 50% of products/search calls in window are slow

// Confounder: feature_flag.experiment_a is enabled at very different rates
// across tiers — naive correlation analysis would suggest the flag causes
// the slowness, but the actual cause is the missing index on tenant_id.
const FEATURE_FLAG_RATE_BY_TIER: Record<string, number> = {
  enterprise: 0.8,
  pro: 0.3,
  free: 0.3,
};

type Rng = GenerateContext['rng'];

function pickNormalLatencyMs(rng: Rng): number {
  const bucket = rng.weightedPick(
    NORMAL_LATENCY_BUCKETS.map(b => ({ value: b, weight: b.weight })),
  );
  return rng.range(bucket.lo, bucket.hi);
}

const SERVICE_POOL_LIST = [
  'api-server',
  'database',
  'search-index',
  'cache',
] as const;

// ─── Background traffic — production-shaped cardinality ─────────────────────
//
// In production environments a single application emits traces from dozens of
// services with thousands of distinct (ServiceName, SpanName) combinations.
// To prevent agents from trivially solving the eval via
// `GROUP BY ServiceName, SpanName ORDER BY p99 DESC LIMIT 20`, we plant a
// pool of ~100 background services × ~15 operations each into the trace
// stream alongside the focal incident pattern. Background traces have
// normal-distribution latency (no spikes) and zero overlap with the
// planted/decoy span names, so they don't confound the rubric — they just
// raise the noise floor of group-by enumerations.

const BG_SERVICE_PREFIXES = [
  'auth',
  'billing',
  'payments',
  'notifications',
  'emails',
  'sms',
  'user-profile',
  'user-prefs',
  'user-events',
  'analytics',
  'metrics',
  'tracing',
  'logging',
  'audit',
  'compliance',
  'gdpr',
  'pii-scan',
  'feature-flag',
  'config',
  'secrets',
  'kms',
  'queue',
  'worker',
  'cron',
  'scheduler',
  'retry',
  'ml-inference',
  'recommendation',
  'personalization',
  'fraud',
  'risk',
  'rate-limiter',
  'throttle',
  'cdn',
  'image-resizer',
  'thumbnailer',
  'media',
  'webhook',
  'integration',
  'partner-api',
  'graph',
  'recommender',
  'feed',
  'timeline',
  'shipping',
  'tax',
  'currency',
  'i18n',
  'inventory-sync',
  'price-sync',
  'catalog-sync',
] as const;
const BG_SERVICE_SUFFIXES = ['v1', 'v2', 'worker', 'api', 'svc'] as const;
const BG_OPERATIONS = [
  'GET /health',
  'GET /ready',
  'GET /metrics',
  'GET /v1/get',
  'POST /v1/create',
  'PUT /v1/update',
  'DELETE /v1/delete',
  'GET /v1/list',
  'GET /v1/search',
  'POST /v1/batch',
  'http.send',
  'http.receive',
  'grpc.call',
  'rpc.invoke',
  'db.query',
  'db.write',
  'db.connect',
  'cache.get',
  'cache.set',
  'cache.evict',
  'queue.publish',
  'queue.consume',
  'queue.ack',
  'compute',
  'transform',
  'serialize',
  'validate',
  'render',
  'enrich',
  'normalize',
  'aggregate',
] as const;
const BG_CHILD_OPERATIONS = [
  'db.select',
  'db.insert',
  'db.update',
  'cache.lookup',
  'cache.store',
  'http.dependency',
  'grpc.dependency',
  'queue.fetch',
  'queue.send',
  'compute.task',
] as const;
const BG_SERVICE_COUNT = 100;
const BG_OPS_PER_SERVICE = 15;

type BgService = {
  name: string;
  operations: readonly string[];
  childOps: readonly string[];
};

function buildBackgroundServices(rng: Rng): BgService[] {
  const services: BgService[] = [];
  const used = new Set<string>();
  // Cap at BG_SERVICE_COUNT distinct names.
  let attempts = 0;
  while (services.length < BG_SERVICE_COUNT && attempts < 10_000) {
    attempts++;
    const prefix = rng.pick(BG_SERVICE_PREFIXES);
    const suffix = rng.pick(BG_SERVICE_SUFFIXES);
    const name = `${prefix}-${suffix}`;
    if (used.has(name)) continue;
    used.add(name);
    // Each service emits ~BG_OPS_PER_SERVICE distinct operations.
    const ops: string[] = [];
    const opsUsed = new Set<string>();
    for (let i = 0; i < BG_OPS_PER_SERVICE; i++) {
      const o = rng.pick(BG_OPERATIONS);
      if (!opsUsed.has(o)) {
        opsUsed.add(o);
        ops.push(o);
      }
    }
    services.push({
      name,
      operations: ops,
      childOps: rng.pick([
        BG_CHILD_OPERATIONS.slice(0, 3),
        BG_CHILD_OPERATIONS.slice(2, 6),
        BG_CHILD_OPERATIONS.slice(5, 10),
      ]),
    });
  }
  return services;
}

export const latencySpikeScenario: Scenario = {
  name: 'latency-spike',
  agentPrompt: groundTruth.agentPrompt,
  description:
    'api-server p99 spike on /api/orders/search for enterprise tenants (missing-index DB query). 12M+ spans across 12 endpoints, 5 regions, 5K tenants, with GC-pause / cold-start / cache-lookup / hot-shard distractors.',
  *generate(ctx): Iterable<ScenarioBatch> {
    const { rng, nowMs } = ctx;
    const factor = ctx.volumeFactor ?? 1;
    const batchSize = ctx.batchSize ?? 10_000;
    const totalTraces = Math.max(50, Math.round(TOTAL_TRACES * factor));
    const resourcePool = buildResourcePool({
      rng,
      services: SERVICE_POOL_LIST,
      instancesPerService: 24,
    });
    const traces: TraceRow[] = [];
    const logs: LogRow[] = [];
    const startMs = nowMs - HISTORY_WINDOW_MS;
    const anomalyStartMs = nowMs - ANOMALY_WINDOW_MS;

    for (let i = 0; i < totalTraces; i++) {
      const t = spreadTimestamp(i, totalTraces, startMs, HISTORY_WINDOW_MS);
      const traceId = newTraceId(rng);
      const endpoint = rng.weightedPick(
        ENDPOINTS.map(e => ({ value: e.name, weight: e.weight })),
      );
      const tenantTier = rng.weightedPick(
        TENANT_TIERS.map(t => ({ value: t.value, weight: t.weight })),
      );
      const tenantId = `${tenantTier}-${rng.intRange(1, TENANT_RANGE)}`;
      const region = rng.pick(REGIONS);

      const inAnomalyWindow = t >= anomalyStartMs;
      const isAffectedSegment =
        inAnomalyWindow &&
        endpoint === 'GET /api/orders/search' &&
        tenantTier === 'enterprise';
      const isCacheHit =
        isAffectedSegment && rng.next() < ENTERPRISE_CACHE_HIT_RATE;
      const isSlowAnomaly = isAffectedSegment && !isCacheHit;

      // Concurrent decoy: products/search hot-shard slowness in the SAME
      // window, all tiers. A real incident on a different endpoint —
      // calibration test for not conflating with the orders/search anomaly.
      const isProductsSearchHotShard =
        inAnomalyWindow &&
        endpoint === 'GET /api/products/search' &&
        rng.next() < PRODUCTS_SEARCH_HOT_SHARD_RATE;

      // Distractors only fire when not the planted anomaly nor the
      // products/search decoy (so duration profiles don't overlap).
      const inColdStartWindow =
        t >= nowMs - COLD_START_WINDOW_START_MS &&
        t <= nowMs - COLD_START_WINDOW_END_MS;
      const isColdStart =
        !isAffectedSegment &&
        !isProductsSearchHotShard &&
        inColdStartWindow &&
        rng.next() < COLD_START_RATE_IN_WINDOW;
      const isGcPause =
        !isAffectedSegment &&
        !isProductsSearchHotShard &&
        !isColdStart &&
        rng.next() < GC_PAUSE_RATE;

      // Feature-flag confounder — correlated with tier but not the cause.
      const flagRate = FEATURE_FLAG_RATE_BY_TIER[tenantTier] ?? 0.3;
      const flagOn = rng.next() < flagRate;

      let dbDurationMs: number;
      let parentDurationMs: number;
      const requestId = uuidv4(rng);
      const userId = `u${rng.intRange(1, 5_000_000)}`;
      const sessionId = uuidv4(rng);
      const route = endpoint.replace(/^[A-Z]+ /, '');
      const queryParam =
        endpoint.includes('search') || endpoint.includes('?')
          ? `?q=${rng.hex(4)}&page=${rng.intRange(1, 50)}&limit=${rng.intRange(10, 100)}`
          : '';
      const parentAttrs: Record<string, string> = {
        'http.method': endpoint.startsWith('POST') ? 'POST' : 'GET',
        'http.route': route,
        'http.target': `${route}${queryParam}`,
        'url.path': route,
        'url.full': `https://api.example.com${route}${queryParam}`,
        'url.scheme': 'https',
        'http.status_code': '200',
        'http.request.body.size': String(rng.intRange(0, 4096)),
        'http.response.body.size': String(rng.intRange(0, 32768)),
        'tenant.id': tenantId,
        'tenant.tier': tenantTier,
        'user.id': userId,
        'session.id': sessionId,
        'cloud.region': region,
        'feature_flag.experiment_a': flagOn ? 'enabled' : 'disabled',
        'request.id': requestId,
        'net.peer.name': 'api-server.svc.cluster.local',
        'rpc.system': 'http',
      };
      const childAttrs: Record<string, string> = {
        'db.system': 'postgres',
        'db.name': 'orders',
        'tenant.id': tenantId,
        'tenant.tier': tenantTier,
        'user.id': userId,
        'request.id': requestId,
        'net.peer.name': 'db-orders-primary.internal',
        'net.peer.port': '5432',
      };
      let childSpanName = 'database.query';
      let childServiceName = 'database';

      if (isSlowAnomaly) {
        dbDurationMs = rng.range(1500, 2500);
        parentDurationMs = dbDurationMs + rng.range(15, 35);
        childAttrs['db.statement'] = 'SELECT * FROM orders WHERE tenant_id = ?';
      } else if (isProductsSearchHotShard) {
        dbDurationMs = rng.range(1500, 2500);
        parentDurationMs = dbDurationMs + rng.range(15, 35);
        childServiceName = 'search-index';
        childSpanName = 'elasticsearch.query';
        childAttrs['db.system'] = 'elasticsearch';
        childAttrs['db.name'] = 'products';
        childAttrs['db.statement'] = 'POST /products/_search';
        childAttrs['elasticsearch.shard.hot'] = 'true';
        childAttrs['elasticsearch.shard.id'] = '17';
      } else if (isCacheHit) {
        // Enterprise cache-hit subset — still fast despite being in window.
        dbDurationMs = rng.range(2, 8);
        parentDurationMs = rng.range(8, 30);
        childAttrs['cache.hit'] = 'true';
        childAttrs['db.statement'] =
          'SELECT * FROM orders WHERE tenant_id = ? -- cached';
      } else if (isGcPause) {
        dbDurationMs = rng.range(20, 60);
        parentDurationMs = rng.range(1500, 2200);
        parentAttrs['runtime.event'] = 'gc_pause';
        parentAttrs['runtime.gc.duration_ms'] = String(
          Math.round(parentDurationMs - dbDurationMs),
        );
      } else if (isColdStart) {
        dbDurationMs = rng.range(20, 60);
        parentDurationMs = rng.range(2000, 3000);
        parentAttrs['runtime.event'] = 'cold_start';
        parentAttrs['runtime.cold_start_ms'] = String(
          Math.round(parentDurationMs - dbDurationMs),
        );
      } else {
        dbDurationMs = rng.range(5, 50);
        parentDurationMs = pickNormalLatencyMs(rng);
        // Endpoint-appropriate db statement
        if (endpoint.startsWith('GET /api/products')) {
          childAttrs['db.name'] = 'products';
          childAttrs['db.statement'] = 'SELECT * FROM products WHERE id = ?';
        } else if (endpoint.startsWith('GET /api/inventory')) {
          childAttrs['db.name'] = 'inventory';
          childAttrs['db.statement'] = 'SELECT * FROM inventory WHERE sku = ?';
        } else {
          childAttrs['db.statement'] = 'SELECT * FROM orders WHERE id = ?';
        }
      }

      const parentSpanId = newSpanId(rng);
      traces.push(
        makeSpan({
          rng,
          timestampMs: t,
          traceId,
          spanId: parentSpanId,
          spanName: endpoint,
          spanKind: 'SPAN_KIND_SERVER',
          serviceName: 'api-server',
          durationNs: msToNs(parentDurationMs),
          resourceAttributes: pickResource(rng, resourcePool, 'api-server'),
          spanAttributes: parentAttrs,
        }),
      );

      traces.push(
        makeSpan({
          rng,
          timestampMs: t + rng.intRange(1, 5),
          traceId,
          spanId: newSpanId(rng),
          parentSpanId,
          spanName: childSpanName,
          spanKind: 'SPAN_KIND_CLIENT',
          serviceName: childServiceName,
          durationNs: msToNs(dbDurationMs),
          resourceAttributes: pickResource(rng, resourcePool, childServiceName),
          spanAttributes: childAttrs,
        }),
      );

      // 3% of traces also get a cache.lookup child (200-400ms) — adds tail
      // latency that an agent might mistake for the spike.
      if (!isAffectedSegment && rng.next() < CACHE_LOOKUP_RATE) {
        traces.push(
          makeSpan({
            rng,
            timestampMs: t + rng.intRange(2, 8),
            traceId,
            spanId: newSpanId(rng),
            parentSpanId,
            spanName: 'cache.lookup',
            spanKind: 'SPAN_KIND_CLIENT',
            serviceName: 'cache',
            durationNs: msToNs(rng.range(200, 400)),
            resourceAttributes: pickResource(rng, resourcePool, 'cache'),
            spanAttributes: {
              'cache.system': 'redis',
              'cache.key': `cache:${rng.hex(8)}`,
              'cache.hit': rng.next() < 0.7 ? 'true' : 'false',
              'request.id': requestId,
              'net.peer.name': 'redis-cache.internal',
              'net.peer.port': '6379',
            },
          }),
        );
      }
      // Stream traces in batches to avoid OOM at high volume.
      if (traces.length >= batchSize) {
        yield { traces: traces.splice(0, traces.length), logs: [] };
      }
    }

    // ── Background traffic ────────────────────────────────────────────────
    // Production-shaped cardinality: ~100 services × ~15 operations each.
    // Normal latency, no slow tails, no overlap with planted span names.
    // Builds a pool from the same rng so the result is deterministic for a
    // given seed.
    const bgServices = buildBackgroundServices(rng);
    const bgResourcePool = buildResourcePool({
      rng,
      services: bgServices.map(s => s.name),
      instancesPerService: 4,
    });
    const bgTotal = Math.max(0, Math.round(BACKGROUND_TRACES * factor));
    for (let i = 0; i < bgTotal; i++) {
      const t = spreadTimestamp(i, bgTotal, startMs, HISTORY_WINDOW_MS);
      const svc = bgServices[i % bgServices.length];
      const op = rng.pick(svc.operations);
      const childOp = rng.pick(svc.childOps);
      const traceId = newTraceId(rng);
      const parentSpanId = newSpanId(rng);
      const parentDurationMs = pickNormalLatencyMs(rng);
      const childDurationMs = Math.round(
        parentDurationMs * rng.range(0.1, 0.7),
      );
      traces.push(
        makeSpan({
          rng,
          timestampMs: t,
          traceId,
          spanId: parentSpanId,
          spanName: op,
          spanKind: 'SPAN_KIND_SERVER',
          serviceName: svc.name,
          durationNs: msToNs(parentDurationMs),
          resourceAttributes: pickResource(rng, bgResourcePool, svc.name),
          spanAttributes: {
            'http.status_code': '200',
            'rpc.system': op.includes('grpc') ? 'grpc' : 'http',
          },
        }),
      );
      traces.push(
        makeSpan({
          rng,
          timestampMs: t + rng.intRange(1, 5),
          traceId,
          spanId: newSpanId(rng),
          parentSpanId,
          spanName: childOp,
          spanKind: 'SPAN_KIND_CLIENT',
          serviceName: svc.name,
          durationNs: msToNs(childDurationMs),
          resourceAttributes: pickResource(rng, bgResourcePool, svc.name),
          spanAttributes: {
            'net.peer.name': `${svc.name}.internal`,
          },
        }),
      );
      if (traces.length >= batchSize) {
        yield { traces: traces.splice(0, traces.length), logs: [] };
      }
    }

    if (traces.length || logs.length) {
      yield { traces, logs };
    }
  },
  groundTruth,
};
