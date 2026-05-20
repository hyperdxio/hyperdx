/**
 * segmented-regression scenario.
 *
 * Story: api-server error rate has gone up in the last 10 minutes, but only
 * for the intersection of `tenant.tier=enterprise` AND `cache.hit=false`.
 * A newly deployed enterprise-only fallback handler has a schema-mismatch
 * bug; it only fires when both conditions hold. Single-axis aggregates
 * (group-by tier only, or group-by cache state only) dilute the signal
 * because most enterprise traffic is cache-hit (normal) and most cache-miss
 * traffic is non-enterprise (normal).
 *
 * Distractors:
 *   - Background 0.5% error rate everywhere (uniform noise).
 *   - Concurrent recommendation-service 502 burst (different service —
 *     real but unrelated incident, tempting because of the timing overlap).
 *
 * What a successful agent does:
 *   1. Spots the elevated error rate on api-server in the last 10 min.
 *   2. Notices that aggregating by tenant.tier alone OR by cache.hit alone
 *      shows only a modest bump.
 *   3. Cross-tabs on (tenant.tier, cache.hit), sees enterprise × miss at
 *      ~12% vs ~0.5% baseline elsewhere.
 *   4. Identifies the schema-mismatch / FallbackHandlerError body pattern.
 *   5. Calls out that recommendation-service is on different traces and
 *      not the cause.
 */
import { makeLog } from '../../generators/logs';
import {
  buildResourcePool,
  pickResource,
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

// ─── Volumes ───────────────────────────────────────────────────────────────

const TOTAL_API_SERVER_TRACES = 6_000_000;
const HISTORY_WINDOW_MS = 60 * 60 * 1000;
const ANOMALY_WINDOW_MS = 10 * 60 * 1000;

// Concurrent distractor burst on a different service.
const REC_DECOY_COUNT = 220;
const REC_DECOY_WINDOW_MS = 12 * 60 * 1000;

// ─── Distribution knobs ───────────────────────────────────────────────────

const TENANT_TIERS = [
  { value: 'free', weight: 60 },
  { value: 'pro', weight: 30 },
  { value: 'enterprise', weight: 10 },
] as const;

const CACHE_HIT_RATE = 0.7; // 70% cache hits, 30% misses

const REGIONS = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-south-1'] as const;

const ENDPOINTS = [
  'GET /api/products/{id}',
  'GET /api/products/search',
  'POST /api/cart/items',
  'GET /api/cart/{id}',
  'GET /api/users/{id}',
  'GET /api/orders/{id}',
  'POST /api/orders',
  'POST /api/checkout',
  'GET /api/recommendations',
  'GET /api/health',
] as const;

// Background error rate everywhere (0.5%) — pure noise, no signal.
const BASELINE_ERROR_RATE = 0.005;

// Anomaly: enterprise × cache.hit=false in the LAST 10 min errors at 12%.
// All other (tier, hit) combinations stay at BASELINE_ERROR_RATE.
const ANOMALY_ERROR_RATE = 0.12;

// Generic background error messages — heterogeneous so simple body grouping
// doesn't immediately reveal the anomaly pattern.
const BACKGROUND_ERROR_BODIES = [
  'upstream connect timeout',
  'context deadline exceeded',
  'temporary unavailable: retry',
  'rate limited by upstream',
  'failed to read response body',
  'invalid request: missing header',
] as const;

// ─── Generator ────────────────────────────────────────────────────────────

type Rng = GenerateContext['rng'];

// Streaming generator: yield batches of `batchSize` rows as we go instead of
// buffering all 6M traces in memory. Without this, full-volume seed runs OOM
// the Node heap even with --max-old-space-size=8192.
function* streamBackgroundRows(
  rng: Rng,
  nowMs: number,
  totalTraces: number,
  batchSize: number,
): Generator<ScenarioBatch, void, void> {
  const startMs = nowMs - HISTORY_WINDOW_MS;
  const anomalyStartMs = nowMs - ANOMALY_WINDOW_MS;
  let tracesBuf: TraceRow[] = [];
  let logsBuf: LogRow[] = [];

  const resourcePool = buildResourcePool({
    rng,
    services: ['api-server'],
    instancesPerService: 24,
  });

  for (let i = 0; i < totalTraces; i++) {
    const t =
      totalTraces > 1
        ? startMs + (i / (totalTraces - 1)) * (HISTORY_WINDOW_MS - 30_000)
        : startMs;

    const tenantTier = rng.weightedPick(
      TENANT_TIERS.map(tt => ({ value: tt.value, weight: tt.weight })),
    );
    const tenantId = `${tenantTier}-${rng.intRange(1, 5_000)}`;
    const cacheHit = rng.next() < CACHE_HIT_RATE;
    const region = rng.pick(REGIONS);
    const endpoint = rng.pick(ENDPOINTS);
    const inAnomalyWindow = t >= anomalyStartMs;
    const isAffectedSegment =
      inAnomalyWindow && tenantTier === 'enterprise' && !cacheHit;
    const errorRate = isAffectedSegment
      ? ANOMALY_ERROR_RATE
      : BASELINE_ERROR_RATE;
    const isError = rng.next() < errorRate;

    const traceId = newTraceId(rng);
    const spanId = newSpanId(rng);
    const resource = pickResource(rng, resourcePool, 'api-server');
    const requestId = uuidv4(rng);
    const userId = `u${rng.intRange(1, 5_000_000)}`;
    const route = endpoint.replace(/^[A-Z]+ /, '');
    const httpMethod = endpoint.startsWith('POST') ? 'POST' : 'GET';

    const spanAttributes: Record<string, string> = {
      'http.method': httpMethod,
      'http.route': route,
      'http.target': route,
      'http.status_code': isError ? '500' : '200',
      'tenant.id': tenantId,
      'tenant.tier': tenantTier,
      'user.id': userId,
      'cloud.region': region,
      'cache.hit': cacheHit ? 'true' : 'false',
      'request.id': requestId,
    };

    let statusCode: TraceRow['statusCode'] = 'STATUS_CODE_OK';
    let statusMessage = '';
    if (isError) {
      statusCode = 'STATUS_CODE_ERROR';
      if (isAffectedSegment) {
        statusMessage =
          'fallback handler returned 500: schema mismatch in enterprise_v2_response';
        spanAttributes['error.type'] = 'FallbackHandlerError';
        spanAttributes['fallback.path'] = 'enterprise_v2';
      } else {
        statusMessage = rng.pick(BACKGROUND_ERROR_BODIES);
        spanAttributes['error.type'] = 'BackgroundError';
      }
    }

    tracesBuf.push(
      makeSpan({
        rng,
        timestampMs: t,
        traceId,
        spanId,
        spanName: endpoint,
        spanKind: 'SPAN_KIND_SERVER',
        serviceName: 'api-server',
        durationNs: msToNs(rng.range(20, 250)),
        statusCode,
        statusMessage,
        resourceAttributes: resource,
        spanAttributes,
      }),
    );

    // Emit a correlated ERROR log for affected-segment failures so an agent
    // searching logs can find the distinctive body too.
    if (isError && isAffectedSegment) {
      logsBuf.push(
        makeLog({
          timestampMs: t + rng.intRange(5, 30),
          serviceName: 'api-server',
          severityText: 'ERROR',
          body: `fallback handler returned 500: schema mismatch in enterprise_v2_response tenant=${tenantId} request_id=${requestId}`,
          traceId,
          spanId,
          logAttributes: {
            'error.kind': 'FallbackHandlerError',
            'tenant.tier': 'enterprise',
            'cache.hit': 'false',
          },
        }),
      );
    }

    if (tracesBuf.length >= batchSize) {
      yield { traces: tracesBuf, logs: logsBuf };
      tracesBuf = [];
      logsBuf = [];
    }
  }
  if (tracesBuf.length > 0 || logsBuf.length > 0) {
    yield { traces: tracesBuf, logs: logsBuf };
  }
}

function buildRecommendationDecoy(
  rng: Rng,
  nowMs: number,
): { traces: TraceRow[]; logs: LogRow[] } {
  const startMs = nowMs - REC_DECOY_WINDOW_MS;
  const traces: TraceRow[] = [];
  const logs: LogRow[] = [];
  for (let i = 0; i < REC_DECOY_COUNT; i++) {
    const t =
      startMs +
      (i / Math.max(REC_DECOY_COUNT - 1, 1)) * (REC_DECOY_WINDOW_MS - 5_000);
    const traceId = newTraceId(rng);
    const spanId = newSpanId(rng);
    traces.push(
      makeSpan({
        rng,
        timestampMs: t,
        traceId,
        spanId,
        spanName: 'rec.compute',
        spanKind: 'SPAN_KIND_SERVER',
        serviceName: 'recommendation-service',
        durationNs: msToNs(rng.range(400, 1200)),
        statusCode: 'STATUS_CODE_ERROR',
        statusMessage: 'rec.compute timed out: upstream cf-feed unreachable',
        spanAttributes: {
          'http.status_code': '502',
          'error.type': 'UpstreamTimeout',
          'upstream.host': 'cf-feed.internal',
        },
      }),
    );
    logs.push(
      makeLog({
        timestampMs: t + rng.intRange(5, 30),
        serviceName: 'recommendation-service',
        severityText: 'ERROR',
        body: 'rec.compute timed out: upstream cf-feed.internal unreachable after 1500ms',
        traceId,
        spanId,
        logAttributes: {
          'error.kind': 'UpstreamTimeout',
          component: 'recommendation-service',
        },
      }),
    );
  }
  return { traces, logs };
}

export const segmentedRegressionScenario: Scenario = {
  name: 'segmented-regression',
  agentPrompt: groundTruth.agentPrompt,
  description:
    '6M api-server traces over an hour. Last 10 min: enterprise × cache-miss errors at ~12% (schema mismatch in a newly deployed fallback). All other (tier, cache) combinations stay at ~0.5% baseline. Single-axis aggregates dilute the signal — the agent must cross-tab. Concurrent recommendation-service 502 burst as distractor.',
  *generate(ctx): Iterable<ScenarioBatch> {
    const factor = ctx.volumeFactor ?? 1;
    const batchSize = ctx.batchSize ?? 10_000;
    const totalTraces = Math.max(
      50,
      Math.round(TOTAL_API_SERVER_TRACES * factor),
    );

    // Stream the background api-server traces in batches so we don't buffer
    // 6M rows in memory.
    yield* streamBackgroundRows(ctx.rng, ctx.nowMs, totalTraces, batchSize);
    // Decoy is small (220 rows) — fine to build in memory.
    const decoy = buildRecommendationDecoy(ctx.rng, ctx.nowMs);
    if (decoy.traces.length > 0) yield { traces: decoy.traces, logs: [] };
    if (decoy.logs.length > 0) yield { traces: [], logs: decoy.logs };
  },
  groundTruth,
};
