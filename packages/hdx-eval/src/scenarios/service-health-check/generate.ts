/**
 * service-health-check scenario.
 *
 * Peace-time SLI report on `api-server`. The dataset is healthy — no
 * incident — but the report window contains four genuinely-novel-but-
 * non-critical signals the agent should call out, plus a couple of
 * recurring/baseline patterns it should NOT escalate.
 *
 * Dataset spans 4 hours ending at `nowMs`:
 *   - Baseline window:  nowMs-240min .. nowMs-60min  (steady, no planted signals)
 *   - Report window:    nowMs-60min  .. nowMs        (what the prompt covers)
 *
 * Planted novel signals (in the report window):
 *   1. New log template "feature_flag.new_recommendation_engine: shadow eval
 *      succeeded …" at ~0.1% of total log volume, starting 70 min before
 *      nowMs. Absent from the baseline.
 *   2. `GET /api/v2/products` endpoint ramps from 0% → ~4% of products
 *      traffic across the report window. Absent from the baseline.
 *   3. p99 latency drifts ~340ms → ~380ms over the report window. Still
 *      well under the stated 500ms SLO. Steady ~340ms in the baseline.
 *   4. 60-second error blip at reportStart+3min: ~5% error rate (~250
 *      errors), all "upstream connect timeout". Outside that minute the
 *      error rate is the baseline 0.5%.
 *
 * Distractors (in BOTH baseline and report window — should NOT be flagged):
 *   5. POST /api/internal/batch-sync 30-second burst every 15 minutes.
 *      Recurring; an agent comparing to baseline can see it's routine.
 *   6. Constant 0.5% background error rate uniformly across endpoints
 *      and time. NOT a regression.
 *
 * Hardness:
 *   - Subtle signals (0.1% / 30ms / 4%) all below typical chart thresholds.
 *   - Log Body has per-row IDs/UUIDs/timestamps so `GROUP BY Body` returns
 *     millions of distinct rows — only hyperdx_log_patterns (Drain) gives
 *     a coherent view.
 *   - Strong calibration penalty: false-alarming on the baseline noise or
 *     escalating the brief blip costs as much as missing a real finding.
 *   - Baseline comparison required: distractor #5 is visible in the report
 *     window only as a "spike"; an agent that queries only the report
 *     window may flag it as novel.
 */
import { makeLog } from '@/generators/logs';
import {
  buildResourcePool,
  pickResource,
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

// ─── Volumes ─────────────────────────────────────────────────────────────────

const TOTAL_TRACES = 12_000_000; //  50K/min × 240 min
const TOTAL_LOGS = 24_000_000; //   100K/min × 240 min

const BASELINE_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours total
const REPORT_WINDOW_MS = 60 * 60 * 1000; //       last hour

// ─── Distractor: recurring batch-sync spike ─────────────────────────────────
const BATCH_SPIKE_PERIOD_MS = 15 * 60 * 1000; //  every 15 min
const BATCH_SPIKE_DURATION_MS = 30 * 1000; //     30s burst
// During a spike window, this fraction of traffic is batch-sync. Tuned so
// the spike adds ~5K extra batch-sync calls per cycle on top of baseline.
const BATCH_SPIKE_SHARE = 0.4;

// ─── Planted #1: new log template ──────────────────────────────────────────
// Appears starting 70 min before nowMs (10 min before the report window).
const NEW_TEMPLATE_LEAD_MS = 70 * 60 * 1000;
const NEW_TEMPLATE_VOLUME_SHARE = 0.001; // 0.1% of TOTAL log volume

// ─── Planted #2: v2 endpoint ramp ─────────────────────────────────────────
// Linear ramp from 0% at reportStart to 4% of products traffic by nowMs.
const V2_PRODUCTS_MAX_SHARE = 0.04;

// ─── Planted #3: latency drift in the report window ───────────────────────
// Scale baseline latency by 1.0 at reportStart, 1.12 at nowMs.
// Baseline p99 ~340ms → end-of-window p99 ~380ms.
const LATENCY_DRIFT_MAX = 0.12;

// ─── Planted #4: brief 60-second error blip ───────────────────────────────
const BLIP_OFFSET_FROM_REPORT_START_MS = 3 * 60 * 1000; // T+3min
const BLIP_DURATION_MS = 60 * 1000; //                    60s
const BLIP_ERROR_RATE = 0.05; //                          5% (vs 0.5% baseline)

// ─── Baseline distribution ──────────────────────────────────────────────────

const BASELINE_ERROR_RATE = 0.005; // 0.5% pure background noise

// Endpoint mix (products is intentionally large so v2 has room to ramp
// visibly within "4% of products traffic").
const ENDPOINTS = [
  { spanName: 'GET /api/v1/products', method: 'GET', weight: 35 },
  { spanName: 'GET /api/cart/{id}', method: 'GET', weight: 25 },
  { spanName: 'POST /api/checkout', method: 'POST', weight: 20 },
  { spanName: 'GET /api/users/{id}', method: 'GET', weight: 20 },
] as const;

const REGIONS = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-south-1'] as const;
const TABLES = [
  'orders',
  'users',
  'products',
  'sessions',
  'inventory',
] as const;
const UPSTREAMS = [
  'cf-feed.internal',
  'recsys.internal',
  'auth.internal',
  'inventory.internal',
] as const;

// ─── Latency ────────────────────────────────────────────────────────────────

type Rng = GenerateContext['rng'];

/**
 * Piecewise distribution chosen so baseline (scale=1) has p50 ~80ms and
 * p99 ~340ms. `scale` multiplies everything — used to drift latency
 * during the report window.
 */
function sampleLatencyMs(rng: Rng, scale: number): number {
  const r = rng.next();
  let base: number;
  if (r < 0.5)
    base = 30 + rng.next() * 70; //          30..100  (p50 ~65)
  else if (r < 0.9)
    base = 60 + rng.next() * 140; //    60..200  (p90 ~190)
  else if (r < 0.99)
    base = 180 + rng.next() * 120; //  180..300 (p99 entry)
  else base = 280 + rng.next() * 80; //                 280..360 (p99 tail)
  return base * scale;
}

function latencyScaleAt(
  t: number,
  reportStartMs: number,
  nowMs: number,
): number {
  if (t < reportStartMs) return 1;
  const frac = Math.min(1, (t - reportStartMs) / (nowMs - reportStartMs));
  return 1 + frac * LATENCY_DRIFT_MAX;
}

// ─── Log body templates ─────────────────────────────────────────────────────
// Every body embeds per-row dynamic values so naive `GROUP BY Body`
// returns ~1 row per log entry. Drain clusters them into the templates
// below.

function buildAccessBody(rng: Rng): string {
  const reqId = uuidv4(rng);
  const method = rng.pick(['GET', 'GET', 'GET', 'POST'] as const);
  const path = `/api/v1/${rng.pick(['products', 'cart', 'users', 'checkout'] as const)}/${rng.intRange(1, 100_000)}`;
  const status = rng.weightedPick([
    { value: 200, weight: 90 },
    { value: 404, weight: 5 },
    { value: 500, weight: 3 },
    { value: 401, weight: 2 },
  ]);
  const latency = rng.intRange(20, 400);
  return `req_id=${reqId} ${method} ${path} -> ${status} in ${latency}ms`;
}

function buildCacheBody(rng: Rng): string {
  const key = `${rng.pick(['user', 'product', 'session'] as const)}:${rng.intRange(1, 1_000_000)}`;
  const hit = rng.next() < 0.85 ? 'true' : 'false';
  const region = rng.pick(REGIONS);
  return `cache.lookup key=${key} hit=${hit} region=${region}`;
}

function buildAuthBody(rng: Rng): string {
  const userId = `u${rng.intRange(1, 5_000_000)}`;
  const sessionId = uuidv4(rng);
  const ttl = rng.intRange(60, 3600);
  return `auth.verified user=${userId} session=${sessionId} ttl=${ttl}s`;
}

function buildRetryBody(rng: Rng): string {
  const upstream = rng.pick(UPSTREAMS);
  const retry = rng.intRange(1, 4);
  const latency = rng.intRange(100, 1500);
  const tenant = `t-${rng.intRange(1, 50_000)}`;
  return `upstream=${upstream} retry=${retry} latency_ms=${latency} tenant=${tenant}`;
}

function buildSlowQueryBody(rng: Rng): string {
  const duration = rng.intRange(200, 1500);
  const table = rng.pick(TABLES);
  const rows = rng.intRange(1000, 1_000_000);
  return `slow.query duration_ms=${duration} table=${table} rows_scanned=${rows}`;
}

function buildNewTemplateBody(rng: Rng): string {
  const corrId = uuidv4(rng);
  const latency = rng.intRange(15, 90);
  return `feature_flag.new_recommendation_engine: shadow eval succeeded correlation_id=${corrId} latency_ms=${latency}`;
}

// Weighted pick for the baseline log template. Add up to 100.
type LogTemplateKind = 'access' | 'cache' | 'auth' | 'retry' | 'slow';
const LOG_TEMPLATES: Array<{
  value: { kind: LogTemplateKind; severity: 'INFO' | 'WARN' };
  weight: number;
}> = [
  { value: { kind: 'access', severity: 'INFO' }, weight: 60 },
  { value: { kind: 'cache', severity: 'INFO' }, weight: 20 },
  { value: { kind: 'auth', severity: 'INFO' }, weight: 10 },
  { value: { kind: 'retry', severity: 'INFO' }, weight: 5 },
  { value: { kind: 'slow', severity: 'WARN' }, weight: 5 },
];

function buildBaselineLogBody(rng: Rng): {
  body: string;
  severityText: 'INFO' | 'WARN';
} {
  const pick = rng.weightedPick(LOG_TEMPLATES);
  switch (pick.kind) {
    case 'access':
      return { body: buildAccessBody(rng), severityText: pick.severity };
    case 'cache':
      return { body: buildCacheBody(rng), severityText: pick.severity };
    case 'auth':
      return { body: buildAuthBody(rng), severityText: pick.severity };
    case 'retry':
      return { body: buildRetryBody(rng), severityText: pick.severity };
    case 'slow':
      return { body: buildSlowQueryBody(rng), severityText: pick.severity };
  }
}

// ─── Streaming generators ──────────────────────────────────────────────────

function* streamTraces(
  rng: Rng,
  nowMs: number,
  totalTraces: number,
  batchSize: number,
): Generator<ScenarioBatch, void, void> {
  const baselineStartMs = nowMs - BASELINE_WINDOW_MS;
  const reportStartMs = nowMs - REPORT_WINDOW_MS;
  const blipStartMs = reportStartMs + BLIP_OFFSET_FROM_REPORT_START_MS;
  const blipEndMs = blipStartMs + BLIP_DURATION_MS;

  const resourcePool = buildResourcePool({
    rng,
    services: ['api-server'],
    instancesPerService: 24,
  });

  let buf: TraceRow[] = [];
  for (let i = 0; i < totalTraces; i++) {
    const t = spreadTimestamp(
      i,
      totalTraces,
      baselineStartMs,
      BASELINE_WINDOW_MS,
    );
    const inReportWindow = t >= reportStartMs;
    const cycleOffset = (t - baselineStartMs) % BATCH_SPIKE_PERIOD_MS;
    const inBatchSpike = cycleOffset < BATCH_SPIKE_DURATION_MS;
    const inBlip = t >= blipStartMs && t < blipEndMs;

    // Endpoint selection
    let spanName: string;
    let httpMethod: string;
    if (inBatchSpike && rng.next() < BATCH_SPIKE_SHARE) {
      spanName = 'POST /api/internal/batch-sync';
      httpMethod = 'POST';
    } else {
      const endpoint = rng.weightedPick(
        ENDPOINTS.map(e => ({ value: e, weight: e.weight })),
      );
      spanName = endpoint.spanName;
      httpMethod = endpoint.method;
      // Planted #2: v2 endpoint ramp. Only inside the report window, and
      // only for the products endpoint.
      if (
        inReportWindow &&
        spanName === 'GET /api/v1/products' &&
        rng.next() <
          ((t - reportStartMs) / (nowMs - reportStartMs)) *
            V2_PRODUCTS_MAX_SHARE
      ) {
        spanName = 'GET /api/v2/products';
      }
    }

    const errorRate = inBlip ? BLIP_ERROR_RATE : BASELINE_ERROR_RATE;
    const isError = rng.next() < errorRate;

    const traceId = newTraceId(rng);
    const spanId = newSpanId(rng);
    const resource = pickResource(rng, resourcePool, 'api-server');
    const requestId = uuidv4(rng);
    const userId = `u${rng.intRange(1, 5_000_000)}`;
    const region = rng.pick(REGIONS);

    let statusCode: TraceRow['statusCode'] = 'STATUS_CODE_OK';
    let statusMessage = '';
    if (isError) {
      statusCode = 'STATUS_CODE_ERROR';
      statusMessage = inBlip
        ? 'upstream connect timeout'
        : rng.pick([
            'connection reset by peer',
            'context deadline exceeded',
            'temporary unavailable: retry',
            'rate limited by upstream',
          ] as const);
    }

    const durationMs = sampleLatencyMs(
      rng,
      latencyScaleAt(t, reportStartMs, nowMs),
    );

    const spanAttributes: Record<string, string> = {
      'http.method': httpMethod,
      'http.route': spanName.replace(/^[A-Z]+ /, ''),
      'http.status_code': isError ? '500' : '200',
      'user.id': userId,
      'cloud.region': region,
      'request.id': requestId,
    };
    if (inBlip) spanAttributes['error.type'] = 'UpstreamTimeout';

    buf.push(
      makeSpan({
        rng,
        timestampMs: t,
        traceId,
        spanId,
        spanName,
        spanKind: 'SPAN_KIND_SERVER',
        serviceName: 'api-server',
        durationNs: msToNs(durationMs),
        statusCode,
        statusMessage,
        resourceAttributes: resource,
        spanAttributes,
      }),
    );

    if (buf.length >= batchSize) {
      yield { traces: buf, logs: [] };
      buf = [];
    }
  }
  if (buf.length > 0) yield { traces: buf, logs: [] };
}

function* streamLogs(
  rng: Rng,
  nowMs: number,
  totalLogs: number,
  batchSize: number,
): Generator<ScenarioBatch, void, void> {
  const baselineStartMs = nowMs - BASELINE_WINDOW_MS;
  const newTemplateStartMs = nowMs - NEW_TEMPLATE_LEAD_MS;

  // Within the planted window, what fraction of rows are the planted
  // template? Calibrated so the planted rows are 0.1% of TOTAL log volume.
  const plantedWindowMs = NEW_TEMPLATE_LEAD_MS;
  const plantedWindowShareOfTotal = plantedWindowMs / BASELINE_WINDOW_MS;
  const plantedShareWithinWindow =
    plantedWindowShareOfTotal > 0
      ? NEW_TEMPLATE_VOLUME_SHARE / plantedWindowShareOfTotal
      : 0;

  let buf: LogRow[] = [];
  for (let i = 0; i < totalLogs; i++) {
    const t = spreadTimestamp(
      i,
      totalLogs,
      baselineStartMs,
      BASELINE_WINDOW_MS,
    );

    let body: string;
    let severityText: 'INFO' | 'WARN';
    if (t >= newTemplateStartMs && rng.next() < plantedShareWithinWindow) {
      body = buildNewTemplateBody(rng);
      severityText = 'INFO';
    } else {
      const baseline = buildBaselineLogBody(rng);
      body = baseline.body;
      severityText = baseline.severityText;
    }

    buf.push(
      makeLog({
        timestampMs: t,
        serviceName: 'api-server',
        severityText,
        body,
        logAttributes: {},
      }),
    );

    if (buf.length >= batchSize) {
      yield { traces: [], logs: buf };
      buf = [];
    }
  }
  if (buf.length > 0) yield { traces: [], logs: buf };
}

export const serviceHealthCheckScenario: Scenario = {
  name: 'service-health-check',
  agentPrompt: groundTruth.agentPrompt,
  description:
    '4-hour dataset on api-server (12M traces + 24M logs). 3-hour steady baseline + 1-hour report window. Healthy service. Four subtle novel signals (new log template, v2 endpoint rollout, p99 latency drift within SLO, brief 60s error blip) plus two distractors (recurring batch-sync spikes, baseline 0.5% error noise). Tests calibrated SLI reporting without false alarms.',
  *generate(ctx): Iterable<ScenarioBatch> {
    const factor = ctx.volumeFactor ?? 1;
    const batchSize = ctx.batchSize ?? 10_000;
    const totalTraces = Math.max(200, Math.round(TOTAL_TRACES * factor));
    const totalLogs = Math.max(400, Math.round(TOTAL_LOGS * factor));

    yield* streamTraces(ctx.rng, ctx.nowMs, totalTraces, batchSize);
    yield* streamLogs(ctx.rng, ctx.nowMs, totalLogs, batchSize);
  },
  groundTruth,
};
