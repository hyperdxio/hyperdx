/**
 * quiet-saturation scenario
 *
 * Story: order-api (4 pods, Node.js) talks to Postgres through a fixed
 * 40-connection pool per pod ('orders-pg'). 90 minutes before `now` a
 * feature flag (`orders.async-invoice`) is rolled from 5% to 100%. The
 * flag-gated async-invoice path LEAKS pooled connections — it acquires a
 * connection and, on a common branch, never releases it. Pool usage climbs
 * monotonically from ~8 toward the 40 cap on every pod (saturating between
 * 36 and 27 minutes ago, staggered by traffic). Once a pod's pool is
 * pinned at 40/40, every request on that pod queues waiting for a
 * connection: latency creeps up UNIFORMLY across ALL order-api routes
 * (the wait happens at acquire time, before any query runs), while the
 * database itself stays fast. In the final ~12 minutes, acquire waits
 * start hitting the 30s pool timeout: a trickle of 503s with distinctive
 * ~30_000ms durations plus ERROR logs that carry the pool stats.
 *
 * DESIGN GOAL — the "metrics are the FAST PATH" middle tier:
 *   - metric-saturation: cause readable ONLY in metrics (forced use).
 *   - deploy-regression: metrics redundant (organic adoption ≈ 0 for
 *     budget-aware agents — measured, not assumed).
 *   - quiet-saturation (this): BOTH paths reach the full answer, but the
 *     metric path is decisively cheaper. Efficiency is read from the
 *     tool-calls / wall-clock columns and the adoption checks, and the
 *     excellence-tier answer facts are history that only metrics (or a
 *     long trace grind) can establish.
 *
 * The two solve paths:
 *   METRIC PATH (~5-7 calls): db.client.connections.usage{state=used}
 *   grouped by pod → monotonic climb from T-90m pinned at 40/40;
 *   db.client.connections.max = 40 names the ceiling;
 *   db.client.connections.pending_requests climbs once pools fill;
 *   http.server.request.count slope is FLAT (rules out a traffic spike —
 *   the climb is a leak, not load); cpu/memory flat (rules out infra).
 *   Join the climb onset to the single feature-flag log event at T-90m.
 *
 *   TRACE/LOG PATH (~12-18 calls): all order-api routes slow together
 *   (no single culprit op — the uniformity IS the clue); slow-trace
 *   waterfalls show db.pool.acquire dominating while the db.query child
 *   stays 5-25ms (the DB is fast; the wait is client-side); the final-
 *   minutes ERROR logs state the pool stats outright ("pool size 40, in
 *   use 40"); the invoice.render span name first appears at the flag
 *   flip. Viable, but reconstructing WHEN the leak started and that
 *   traffic stayed flat takes many more windowed queries.
 *
 * Distractors:
 *   - INNOCENT completed notification-service deploy ~40 min ago — lands
 *     near the VISIBLE latency onset (~30 min ago). Healthy on both
 *     versions; not in the order path's failure chain. The pool climb
 *     predates it by ~50 minutes.
 *   - inventory-service CPU spike (0.85-0.95) from T-60m to T-45m: a
 *     nightly reconciliation batch, bracketed by INFO logs. Alarming on a
 *     chart, unrelated to order-api.
 *   - catalog-api pool TWIN: same db.client.connections.* metric names,
 *     healthy ~8/40 usage throughout — isolating order-api requires
 *     filtering by service, not keyword-hunting metric names.
 *   - Constant-rate NonFatalRetryableError caught-exception noise on
 *     order-api (rate does not change at any boundary).
 *   - The DB-is-slow trap: db.query children stay fast throughout, so
 *     "Postgres is overloaded" is a calibration failure the rubric
 *     penalizes.
 *
 * Consistency features copied from deploy-regression's hardening rounds:
 * 26-turn cap with a soft answer checkpoint, the count-your-tool-calls
 * budget note, the truncation-strict judge preamble, and a signalsNote
 * byte-identical to metric-saturation's (adoption parity).
 */
import { makeLog } from '@/generators/logs';
import {
  bucketize,
  makeGauge,
  makeHistogram,
  makeSum,
} from '@/generators/metrics';
import {
  buildResourcePool,
  cacheHitLog,
  caughtExceptionLog,
  envoyAccessLog,
  normalizeSeverityText,
  pickResource,
  serviceOpsDebugLog,
  spreadTimestamp,
  upstreamHealthProbeLog,
} from '@/generators/templates';
import { makeSpan, msToNs, newSpanId, newTraceId } from '@/generators/traces';
import type {
  GaugeMetricRow,
  HistogramMetricRow,
  LogRow,
  SumMetricRow,
  TraceRow,
} from '@/generators/types';
import { buildInvestigationSystemPrompt } from '@/harness/systemPrompt';
import type {
  GenerateContext,
  MetricBatch,
  Scenario,
  ScenarioBatch,
} from '@/scenarios/types';

import groundTruth from './ground-truth.json';

// ─── Services ───────────────────────────────────────────────────────────────

const SUBJECT_SERVICE = 'order-api';
const TWIN_SERVICE = 'catalog-api';
const NOTIFY_SERVICE = 'notification-service';
const NEIGHBOR_SERVICE = 'inventory-service';
const PROXY_SERVICE = 'frontend-proxy';

// ─── Time model ─────────────────────────────────────────────────────────────
// 3-hour window so the pre-leak baseline is clearly visible. The flag flips
// 90 min before `now`; pod pools saturate 36..27 min before `now`
// (staggered by traffic); acquire timeouts appear in the last 12 min.

const HISTORY_WINDOW_MS = 3 * 60 * 60 * 1000;
const SCRAPE_INTERVAL_MS = 60 * 1000;
const FLAG_FLIP_AGO_MS = 90 * 60 * 1000;
const TIMEOUT_ERRORS_AGO_MS = 12 * 60 * 1000;

const POD_COUNT = 4;
/** Pod i's pool pins at 40/40 this long before `now` (staggered 3 min). */
const POD_SATURATION_AGO_MS = [36, 33, 30, 27].map(m => m * 60 * 1000);

// Innocent notification-service rollout: starts 40 min ago, one pod per
// minute (3 pods), completed 37 min ago — right next to the VISIBLE
// latency onset, 50 minutes after the actual leak began.
const NOTIFY_DEPLOY_AGO_MS = 40 * 60 * 1000;
const NOTIFY_ROLLOUT_STAGGER_MS = 60 * 1000;
const NOTIFY_POD_COUNT = 3;
const NOTIFY_OLD_VERSION = '2.14.0';
const NOTIFY_NEW_VERSION = '2.15.0';

// inventory-service nightly batch (CPU-spike red herring): T-60m..T-45m.
const BATCH_START_AGO_MS = 60 * 60 * 1000;
const BATCH_END_AGO_MS = 45 * 60 * 1000;

// ─── Pool model ─────────────────────────────────────────────────────────────

const POOL_NAME = 'orders-pg';
const POOL_MAX = 40;
const POOL_BASE_USED = 8;
const ACQUIRE_TIMEOUT_MS = 30_000;
/** Max acquire wait (ms) reached at `now` on the earliest-saturated pod. */
const MAX_QUEUE_WAIT_MS = 2_600;
/** Fraction of requests on a saturated pod that hit the 30s acquire
 *  timeout during the final TIMEOUT_ERRORS_AGO_MS window. */
const TIMEOUT_FRACTION = 0.05;

const FLAG_KEY = 'orders.async-invoice';
const FLAG_FLIP_BODY =
  `Feature flag ${FLAG_KEY} rollout updated: 5% -> 100% ` +
  '(actor: platform-team, change ORD-4112)';

const TIMEOUT_LOG_BODY = (pending: number) =>
  `Timeout: failed to acquire connection from pool '${POOL_NAME}' within ` +
  `${ACQUIRE_TIMEOUT_MS}ms (pool size ${POOL_MAX}, in use ${POOL_MAX}, ` +
  `pending ${pending})`;

// ─── Metric constants ───────────────────────────────────────────────────────

const LATENCY_BOUNDS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const ORDER_REQS_PER_SCRAPE = 180; // flat — traffic never changes

// ─── Volumes ────────────────────────────────────────────────────────────────
// Root spans get acquire/query children, so the root count is lower than
// deploy-regression's to keep total rows comparable. Planted events (flag
// flip, rollout logs, batch markers) stay fixed.

const TOTAL_TRACES = 220_000;
const TOTAL_LOGS = 700_000;

const TRAFFIC_MIX = [
  { value: 'order_create', weight: 22 },
  { value: 'order_get', weight: 18 },
  { value: 'cart', weight: 15 },
  { value: 'catalog', weight: 30 },
  { value: 'notify', weight: 15 },
] as const;

const LOG_MIX = [
  { value: 'cache_hit', weight: 28 },
  { value: 'envoy', weight: 27 },
  { value: 'health_probe', weight: 10 },
  { value: 'inventory_ops', weight: 20 },
  { value: 'caught_exception', weight: 15 },
] as const;

type Rng = GenerateContext['rng'];

// ─── Saturation model ───────────────────────────────────────────────────────

function podSaturationMs(nowMs: number, pod: number): number {
  return nowMs - POD_SATURATION_AGO_MS[pod % POD_COUNT];
}

/** Pooled connections in use on `pod` at `t` — monotonic ramp, pinned at
 *  POOL_MAX after saturation. Deterministic (no jitter) so the "usage
 *  never decreases" invariant is exact. */
function poolUsed(nowMs: number, pod: number, t: number): number {
  const leakStart = nowMs - FLAG_FLIP_AGO_MS;
  if (t < leakStart) return POOL_BASE_USED;
  const full = podSaturationMs(nowMs, pod);
  if (t >= full) return POOL_MAX;
  const frac = (t - leakStart) / (full - leakStart);
  return Math.min(
    POOL_MAX,
    POOL_BASE_USED + Math.round((POOL_MAX - POOL_BASE_USED) * frac),
  );
}

/** Acquire queue wait (ms) on `pod` at `t`. Zero until the pod's pool is
 *  pinned; then grows super-linearly toward MAX_QUEUE_WAIT_MS at `now`. */
function queueWaitMs(rng: Rng, nowMs: number, pod: number, t: number): number {
  const full = podSaturationMs(nowMs, pod);
  if (t < full) return rng.range(0.2, 2); // healthy acquire: sub-2ms
  const frac = (t - full) / (nowMs - full);
  const wait = Math.pow(frac, 1.5) * MAX_QUEUE_WAIT_MS;
  return wait * rng.range(0.75, 1.25);
}

/** Pending acquire requests gauge on `pod` at `t`. */
function poolPending(rng: Rng, nowMs: number, pod: number, t: number): number {
  const full = podSaturationMs(nowMs, pod);
  if (t < full) return rng.next() < 0.05 ? 1 : 0;
  const frac = (t - full) / (nowMs - full);
  return Math.round(Math.pow(frac, 1.5) * 32 * rng.range(0.8, 1.2));
}

// ─── Metric generation ──────────────────────────────────────────────────────

function generateMetrics(rng: Rng, nowMs: number): MetricBatch {
  const windowStart = nowMs - HISTORY_WINDOW_MS;
  const scrapeCount = Math.floor(HISTORY_WINDOW_MS / SCRAPE_INTERVAL_MS);

  const gauge: GaugeMetricRow[] = [];
  const sum: SumMetricRow[] = [];
  const histogram: HistogramMetricRow[] = [];

  const podResource = (
    service: string,
    pod: number,
  ): Record<string, string> => ({
    'service.name': service,
    'service.namespace': 'production',
    'k8s.namespace.name': 'production',
    'k8s.deployment.name': service,
    'k8s.pod.name': `${service}-7f${pod}d${pod * 3 + 1}c-${pod}q${pod + 4}z${pod * 2}`,
  });
  const subjectPods = Array.from({ length: POD_COUNT }, (_, p) =>
    podResource(SUBJECT_SERVICE, p),
  );
  const twinPods = Array.from({ length: 2 }, (_, p) =>
    podResource(TWIN_SERVICE, p),
  );
  const neighborResource = podResource(NEIGHBOR_SERVICE, 0);

  let cumRequests = 0;

  for (let i = 0; i < scrapeCount; i++) {
    const t = windowStart + i * SCRAPE_INTERVAL_MS;

    // ── order-api: the load-bearing pool gauges, per pod ─────────────────
    for (let pod = 0; pod < POD_COUNT; pod++) {
      const used = poolUsed(nowMs, pod, t);
      const attrsBase = { 'pool.name': POOL_NAME, 'db.system': 'postgresql' };
      gauge.push(
        makeGauge({
          timeUnixMs: t,
          serviceName: SUBJECT_SERVICE,
          metricName: 'db.client.connections.usage',
          metricUnit: '{connection}',
          metricDescription: 'Connections currently in use or idle, by state',
          value: used,
          resourceAttributes: subjectPods[pod],
          attributes: { ...attrsBase, state: 'used' },
        }),
        makeGauge({
          timeUnixMs: t,
          serviceName: SUBJECT_SERVICE,
          metricName: 'db.client.connections.usage',
          metricUnit: '{connection}',
          metricDescription: 'Connections currently in use or idle, by state',
          value: POOL_MAX - used,
          resourceAttributes: subjectPods[pod],
          attributes: { ...attrsBase, state: 'idle' },
        }),
        makeGauge({
          timeUnixMs: t,
          serviceName: SUBJECT_SERVICE,
          metricName: 'db.client.connections.max',
          metricUnit: '{connection}',
          metricDescription: 'Maximum configured pool size',
          value: POOL_MAX,
          resourceAttributes: subjectPods[pod],
          attributes: attrsBase,
        }),
        makeGauge({
          timeUnixMs: t,
          serviceName: SUBJECT_SERVICE,
          metricName: 'db.client.connections.pending_requests',
          metricUnit: '{request}',
          metricDescription:
            'Requests currently waiting for an open connection',
          value: poolPending(rng, nowMs, pod, t),
          resourceAttributes: subjectPods[pod],
          attributes: attrsBase,
        }),
        // Healthy infra gauges — rules out CPU/memory saturation.
        makeGauge({
          timeUnixMs: t,
          serviceName: SUBJECT_SERVICE,
          metricName: 'system.cpu.utilization',
          metricUnit: '1',
          metricDescription: 'CPU utilization (0-1)',
          value: Number(rng.range(0.18, 0.3).toFixed(3)),
          resourceAttributes: subjectPods[pod],
          attributes: { state: 'used' },
        }),
        makeGauge({
          timeUnixMs: t,
          serviceName: SUBJECT_SERVICE,
          metricName: 'process.memory.usage',
          metricUnit: 'By',
          metricDescription: 'Process resident memory',
          value: Math.round(rng.range(380, 430) * 1024 * 1024),
          resourceAttributes: subjectPods[pod],
          attributes: {},
        }),
      );
    }

    // ── catalog-api: healthy pool TWIN (same metric names) ───────────────
    for (let pod = 0; pod < twinPods.length; pod++) {
      const attrsBase = {
        'pool.name': 'catalog-pg',
        'db.system': 'postgresql',
      };
      const used = rng.intRange(5, 11);
      gauge.push(
        makeGauge({
          timeUnixMs: t,
          serviceName: TWIN_SERVICE,
          metricName: 'db.client.connections.usage',
          metricUnit: '{connection}',
          metricDescription: 'Connections currently in use or idle, by state',
          value: used,
          resourceAttributes: twinPods[pod],
          attributes: { ...attrsBase, state: 'used' },
        }),
        makeGauge({
          timeUnixMs: t,
          serviceName: TWIN_SERVICE,
          metricName: 'db.client.connections.max',
          metricUnit: '{connection}',
          metricDescription: 'Maximum configured pool size',
          value: POOL_MAX,
          resourceAttributes: twinPods[pod],
          attributes: attrsBase,
        }),
        makeGauge({
          timeUnixMs: t,
          serviceName: TWIN_SERVICE,
          metricName: 'db.client.connections.pending_requests',
          metricUnit: '{request}',
          metricDescription:
            'Requests currently waiting for an open connection',
          value: 0,
          resourceAttributes: twinPods[pod],
          attributes: attrsBase,
        }),
      );
    }

    // ── inventory-service: nightly-batch CPU spike (red herring) ─────────
    const inBatch =
      t >= nowMs - BATCH_START_AGO_MS && t <= nowMs - BATCH_END_AGO_MS;
    gauge.push(
      makeGauge({
        timeUnixMs: t,
        serviceName: NEIGHBOR_SERVICE,
        metricName: 'system.cpu.utilization',
        metricUnit: '1',
        metricDescription: 'CPU utilization (0-1)',
        value: Number(
          (inBatch ? rng.range(0.85, 0.95) : rng.range(0.2, 0.3)).toFixed(3),
        ),
        resourceAttributes: neighborResource,
        attributes: { state: 'used' },
      }),
    );

    // ── order-api request-duration histogram (delta) + flat traffic sum ──
    // Aggregate across pods: sample the same per-request model the traces
    // use so the two signals agree.
    const samples: number[] = [];
    for (let s = 0; s < ORDER_REQS_PER_SCRAPE; s++) {
      const pod = s % POD_COUNT;
      samples.push(rng.range(25, 220) + queueWaitMs(rng, nowMs, pod, t));
    }
    histogram.push(
      makeHistogram({
        timeUnixMs: t,
        serviceName: SUBJECT_SERVICE,
        metricName: 'http.server.request.duration',
        metricUnit: 'ms',
        metricDescription: 'HTTP server request duration',
        aggregationTemporality: 1,
        ...bucketize(samples, LATENCY_BOUNDS_MS),
        explicitBounds: [...LATENCY_BOUNDS_MS],
        resourceAttributes: {
          'service.name': SUBJECT_SERVICE,
          'service.namespace': 'production',
          'k8s.deployment.name': SUBJECT_SERVICE,
        },
        attributes: {},
      }),
    );
    // FLAT request-rate counter: the leak-vs-load discriminator. The
    // pool climbs while this slope never changes.
    cumRequests += ORDER_REQS_PER_SCRAPE;
    sum.push(
      makeSum({
        timeUnixMs: t,
        serviceName: SUBJECT_SERVICE,
        metricName: 'http.server.request.count',
        metricDescription: 'Cumulative HTTP requests served',
        value: cumRequests,
        resourceAttributes: {
          'service.name': SUBJECT_SERVICE,
          'service.namespace': 'production',
          'k8s.deployment.name': SUBJECT_SERVICE,
        },
        attributes: {},
      }),
    );
  }

  return { gauge, sum, histogram };
}

// ─── Scenario ───────────────────────────────────────────────────────────────

const QUIET_MAX_TURNS = 26;
const SOFT_ANSWER_TURN_MARGIN = 8;

const BUDGET_NOTE = `
HARD BUDGETS: this run has a hard tool-call cap a few calls above the
soft checkpoint in the TURN BUDGET above, AND a hard wall-clock limit of
roughly five minutes. Neither budget waits for an unfinished
investigation — when either runs out, whatever you last wrote IS your
answer. You cannot see the wall clock; the only budget you can track is
your own tool-call count, so budget by COUNTING TOOL CALLS:
- Prefer aggregating queries over reading individual events.
- At the soft checkpoint, STOP opening new lines of investigation and
  write the best-supported conclusion from the evidence you already have.
- Reserve the final turn for the answer — never let a verification query
  be your last action. An answer grounded in partial evidence scores; an
  unfinished investigation with no written answer scores zero.`;

const JUDGE_PREAMBLE = `You are evaluating an SRE investigation. You will receive:
- the scenario question (what the candidate was asked)
- the ground-truth facts (the planted answer the candidate did NOT see)
- a rubric with weighted criteria
- the candidate's final answer (anonymized — tool names and product brands have been redacted so you cannot tell which tool the candidate used)

For each rubric criterion, output an integer score from 0 to 5 plus a one-sentence rationale. Do not consider tool choice, query syntax, or implementation details — score only the quality of the candidate's final answer relative to the ground truth.

SCORE ONLY WHAT IS WRITTEN. Credit a claim only if the candidate's answer
states it explicitly — never because the ground-truth facts contain it or
because the candidate seemed about to conclude it. Some answers are
truncated mid-investigation: a progress note, a plan, or a statement of
intent ("let me verify one more thing", "I now have the complete picture")
with no actual diagnosis. Such an answer scores 0 on every criterion
except conciseness (at most 1), no matter how promising the investigation
looked.

Return STRICT JSON of shape:
{ "scores": { "<criterion_id>": { "score": N, "rationale": "..." } } }
No prose outside the JSON. Include every criterion id from the rubric.`;

export const quietSaturationScenario: Scenario = {
  name: 'quiet-saturation',
  agentPrompt: groundTruth.agentPrompt,
  maxTurns: QUIET_MAX_TURNS,
  description:
    'order-api DB connection-pool exhaustion via a slow leak: the orders.async-invoice ' +
    'feature flag goes 5%->100% 90 min ago and the flag-gated path leaks pooled ' +
    'connections; per-pod usage climbs monotonically to the 40-connection cap ' +
    '(saturating 36-27 min ago), after which every request queues on acquire — ' +
    'UNIFORM latency creep across all routes with fast db.query children, and 30s ' +
    'acquire-timeout 503s in the final 12 min. The metrics-are-the-fast-path middle ' +
    'tier between metric-saturation (metrics forced) and deploy-regression (metrics ' +
    'redundant): both solve paths reach the full answer, but pool gauges + the flat ' +
    'request-count sum crack it in a handful of calls while the trace/log grind is ' +
    'viable but slow. Distractors: innocent notification-service deploy near the ' +
    'visible onset, inventory-service nightly-batch CPU spike, a healthy catalog-api ' +
    'pool twin with identical metric names, constant caught-exception noise, and the ' +
    'DB-is-slow trap (queries stay fast; the wait is client-side).',
  buildSystemPrompt: ctx => {
    const softAnswerTurn = Math.max(
      10,
      (ctx.maxTurns ?? QUIET_MAX_TURNS) - SOFT_ANSWER_TURN_MARGIN,
    );
    return (
      buildInvestigationSystemPrompt(
        'quiet-saturation',
        ctx.anchorTimeIso,
        ctx.variant,
        softAnswerTurn,
        {
          // Byte-identical to metric-saturation / deploy-regression:
          // discoverability is held constant across scenarios so adoption
          // deltas measure inclination, not awareness.
          signalsNote:
            '- Metrics: a HyperDX metric source is available (gauge, sum, ' +
            'histogram, exponential histogram, and summary). Use the metric ' +
            'tools to explore it alongside traces and logs.',
        },
      ) + BUDGET_NOTE
    );
  },
  judgeSystemPreamble: JUDGE_PREAMBLE,
  *generate(ctx): Iterable<ScenarioBatch> {
    const { rng, nowMs } = ctx;
    const factor = ctx.volumeFactor ?? 1;
    const batchSize = ctx.batchSize ?? 10_000;
    const windowStart = nowMs - HISTORY_WINDOW_MS;
    const flagFlipMs = nowMs - FLAG_FLIP_AGO_MS;

    // Metrics first (fixed volume — the load-bearing signal never scales).
    const metrics = generateMetrics(rng, nowMs);
    yield { traces: [], logs: [], metrics };

    const pinDeployment = (r: Record<string, string>) => ({
      ...r,
      'service.namespace': 'production',
      'k8s.namespace.name': 'production',
      'deployment.environment.name': 'production',
      'cloud.region': 'us-east-1',
    });
    const pinNode = (
      attrs: Record<string, string>,
      poolName: string,
    ): Record<string, string> => {
      const node = `gke-prod-${poolName}-${rng.hex(8)}-${rng.hex(4)}`;
      return { ...attrs, 'k8s.node.name': node, 'host.name': node };
    };

    const orderPods = buildResourcePool({
      rng,
      services: [SUBJECT_SERVICE],
      instancesPerService: POD_COUNT,
    })[SUBJECT_SERVICE].map(r =>
      pinNode(
        pinDeployment({ ...r, 'telemetry.sdk.language': 'nodejs' }),
        'order',
      ),
    );

    const notifyPods = buildResourcePool({
      rng,
      services: [NOTIFY_SERVICE],
      instancesPerService: NOTIFY_POD_COUNT,
    })[NOTIFY_SERVICE].map(r => pinNode(pinDeployment(r), 'notify'));
    const notifyVersion = (pod: number, t: number): string =>
      t >= nowMs - NOTIFY_DEPLOY_AGO_MS + pod * NOTIFY_ROLLOUT_STAGGER_MS
        ? NOTIFY_NEW_VERSION
        : NOTIFY_OLD_VERSION;

    const resourcePool = buildResourcePool({
      rng,
      services: [PROXY_SERVICE, TWIN_SERVICE, NEIGHBOR_SERVICE],
      instancesPerService: 8,
    });

    // ── Trace floor: order-api requests with acquire/query children ──────
    const totalTraces = Math.max(50, Math.round(TOTAL_TRACES * factor));
    const traces: TraceRow[] = [];
    const plantedLogs: LogRow[] = [];

    for (let i = 0; i < totalTraces; i++) {
      const t = spreadTimestamp(i, totalTraces, windowStart, HISTORY_WINDOW_MS);
      const kind = rng.weightedPick(TRAFFIC_MIX);

      if (kind === 'catalog') {
        traces.push(
          makeSpan({
            rng,
            timestampMs: t,
            traceId: newTraceId(rng),
            spanId: newSpanId(rng),
            spanName: 'GET /api/catalog/search',
            spanKind: 'SPAN_KIND_SERVER',
            serviceName: TWIN_SERVICE,
            durationNs: msToNs(rng.range(10, 90)),
            resourceAttributes: pickResource(rng, resourcePool, TWIN_SERVICE),
            spanAttributes: {
              'http.route': '/api/catalog/search',
              'http.request.method': 'GET',
              'http.response.status_code': '200',
            },
          }),
        );
      } else if (kind === 'notify') {
        const pod = rng.intRange(0, NOTIFY_POD_COUNT);
        traces.push(
          makeSpan({
            rng,
            timestampMs: t,
            traceId: newTraceId(rng),
            spanId: newSpanId(rng),
            spanName: 'notification.send',
            spanKind: 'SPAN_KIND_SERVER',
            serviceName: NOTIFY_SERVICE,
            durationNs: msToNs(rng.range(12, 80)),
            resourceAttributes: {
              ...notifyPods[pod],
              'service.version': notifyVersion(pod, t),
            },
            spanAttributes: {
              'messaging.system': 'sns',
              'notification.channel': rng.pick(['email', 'push', 'sms']),
            },
          }),
        );
      } else {
        // order-api request
        const pod = rng.intRange(0, POD_COUNT);
        const resourceAttributes = orderPods[pod];
        const route =
          kind === 'order_create'
            ? '/api/orders'
            : kind === 'order_get'
              ? '/api/orders/{orderId}'
              : '/api/cart';
        const method = kind === 'order_create' ? 'POST' : 'GET';
        const spanName = `${method} ${route}`;

        const baseMs =
          kind === 'order_create' ? rng.range(60, 250) : rng.range(20, 120);
        const waitMs = queueWaitMs(rng, nowMs, pod, t);
        const queryMs = rng.range(5, 25); // the DB stays fast — always

        // Acquire-timeout failures: saturated pod, final window only.
        const saturated = t >= podSaturationMs(nowMs, pod);
        const inTimeoutWindow = t >= nowMs - TIMEOUT_ERRORS_AGO_MS;
        const timedOut =
          saturated && inTimeoutWindow && rng.next() < TIMEOUT_FRACTION;

        const traceId = newTraceId(rng);
        const rootSpanId = newSpanId(rng);

        if (timedOut) {
          // The request spends the full acquire timeout waiting, then 503s.
          const totalMs = ACQUIRE_TIMEOUT_MS + rng.range(5, 40);
          traces.push(
            makeSpan({
              rng,
              timestampMs: t,
              traceId,
              spanId: rootSpanId,
              spanName,
              spanKind: 'SPAN_KIND_SERVER',
              serviceName: SUBJECT_SERVICE,
              durationNs: msToNs(totalMs),
              statusCode: 'STATUS_CODE_ERROR',
              statusMessage: 'connection acquisition timeout',
              resourceAttributes,
              spanAttributes: {
                'http.route': route,
                'http.request.method': method,
                'http.response.status_code': '503',
              },
            }),
            makeSpan({
              rng,
              timestampMs: t + 1,
              traceId,
              spanId: newSpanId(rng),
              parentSpanId: rootSpanId,
              spanName: 'db.pool.acquire',
              spanKind: 'SPAN_KIND_INTERNAL',
              serviceName: SUBJECT_SERVICE,
              durationNs: msToNs(ACQUIRE_TIMEOUT_MS),
              statusCode: 'STATUS_CODE_ERROR',
              statusMessage: 'timed out waiting for connection',
              resourceAttributes,
              spanAttributes: {
                'db.system': 'postgresql',
                'pool.name': POOL_NAME,
              },
            }),
          );
          plantedLogs.push(
            makeLog({
              timestampMs: t + ACQUIRE_TIMEOUT_MS,
              traceId,
              spanId: rootSpanId,
              serviceName: SUBJECT_SERVICE,
              severityText: 'ERROR',
              body: TIMEOUT_LOG_BODY(rng.intRange(14, 34)),
              resourceAttributes,
              logAttributes: {
                'event.name': 'db.pool.acquire_timeout',
                'pool.name': POOL_NAME,
                'db.system': 'postgresql',
                'http.route': route,
                'log.iostream': 'stderr',
              },
            }),
          );
        } else {
          const totalMs = baseMs + waitMs + queryMs;
          traces.push(
            makeSpan({
              rng,
              timestampMs: t,
              traceId,
              spanId: rootSpanId,
              spanName,
              spanKind: 'SPAN_KIND_SERVER',
              serviceName: SUBJECT_SERVICE,
              durationNs: msToNs(totalMs),
              resourceAttributes,
              spanAttributes: {
                'http.route': route,
                'http.request.method': method,
                'http.response.status_code': '200',
                ...(kind === 'order_create'
                  ? {
                      'order.items': String(rng.intRange(1, 9)),
                      'order.total_cents': String(rng.intRange(999, 74999)),
                    }
                  : {}),
              },
            }),
            // Child 1: pool acquire — THE growing wait (client-side).
            makeSpan({
              rng,
              timestampMs: t + 1,
              traceId,
              spanId: newSpanId(rng),
              parentSpanId: rootSpanId,
              spanName: 'db.pool.acquire',
              spanKind: 'SPAN_KIND_INTERNAL',
              serviceName: SUBJECT_SERVICE,
              durationNs: msToNs(waitMs),
              resourceAttributes,
              spanAttributes: {
                'db.system': 'postgresql',
                'pool.name': POOL_NAME,
              },
            }),
            // Child 2: the actual query — fast the whole time (the DB
            // itself is healthy; "Postgres is slow" is a trap).
            makeSpan({
              rng,
              timestampMs: t + 2 + Math.floor(waitMs),
              traceId,
              spanId: newSpanId(rng),
              parentSpanId: rootSpanId,
              spanName:
                kind === 'order_create' ? 'INSERT orders' : 'SELECT orders',
              spanKind: 'SPAN_KIND_CLIENT',
              serviceName: SUBJECT_SERVICE,
              durationNs: msToNs(queryMs),
              resourceAttributes,
              spanAttributes: {
                'db.system': 'postgresql',
                'db.name': 'orders',
                'server.address': 'orders-pg.prod.internal',
              },
            }),
          );
          // Post-flip: the flag-gated async-invoice child appears — a NEW
          // span name whose first occurrence marks the flip boundary.
          if (kind === 'order_create' && t >= flagFlipMs) {
            traces.push(
              makeSpan({
                rng,
                timestampMs: t + 4 + Math.floor(waitMs),
                traceId,
                spanId: newSpanId(rng),
                parentSpanId: rootSpanId,
                spanName: 'invoice.render_async',
                spanKind: 'SPAN_KIND_INTERNAL',
                serviceName: SUBJECT_SERVICE,
                durationNs: msToNs(rng.range(25, 80)),
                resourceAttributes,
                spanAttributes: {
                  'feature_flag.key': FLAG_KEY,
                  'invoice.format': 'pdf',
                },
              }),
            );
          }
        }
      }

      if (traces.length >= batchSize) {
        yield { traces: traces.splice(0, traces.length), logs: [] };
      }
      if (plantedLogs.length >= batchSize) {
        yield { traces: [], logs: plantedLogs.splice(0, plantedLogs.length) };
      }
    }
    if (traces.length)
      yield { traces: traces.splice(0, traces.length), logs: [] };

    // ── Log floor ─────────────────────────────────────────────────────────
    const totalLogs = Math.max(50, Math.round(TOTAL_LOGS * factor));
    const logs: LogRow[] = [];
    for (let i = 0; i < totalLogs; i++) {
      const t = spreadTimestamp(
        i,
        totalLogs,
        windowStart,
        HISTORY_WINDOW_MS,
        60_000,
      );
      const kind = rng.weightedPick(LOG_MIX);
      let service: string;
      let resourceAttributes: Record<string, string>;
      let body: string;
      let attrs: Record<string, string>;
      let sevText: string;

      if (kind === 'cache_hit' || kind === 'caught_exception') {
        service = SUBJECT_SERVICE;
        resourceAttributes = orderPods[rng.intRange(0, POD_COUNT)];
        const tmpl =
          kind === 'cache_hit'
            ? cacheHitLog({ rng, nowMs: t })
            : caughtExceptionLog({ rng, nowMs: t });
        body = tmpl.body;
        attrs = tmpl.attrs;
        sevText = tmpl.level;
      } else if (kind === 'envoy' || kind === 'health_probe') {
        service = PROXY_SERVICE;
        resourceAttributes = pickResource(rng, resourcePool, PROXY_SERVICE);
        const tmpl =
          kind === 'envoy'
            ? envoyAccessLog({ rng, nowMs: t })
            : upstreamHealthProbeLog({ rng, nowMs: t });
        body = tmpl.body;
        attrs = tmpl.attrs;
        sevText = 'info';
      } else {
        service = NEIGHBOR_SERVICE;
        resourceAttributes = pickResource(rng, resourcePool, NEIGHBOR_SERVICE);
        const tmpl = serviceOpsDebugLog({
          rng,
          nowMs: t,
          serviceName: 'inventory-service',
        });
        body = tmpl.body;
        attrs = tmpl.attrs;
        sevText = tmpl.level;
      }

      logs.push(
        makeLog({
          timestampMs: t,
          serviceName: service,
          severityText: normalizeSeverityText(sevText),
          body,
          resourceAttributes,
          logAttributes: { ...attrs, _severity_raw: sevText },
        }),
      );
      if (logs.length >= batchSize) {
        yield { traces: [], logs: logs.splice(0, logs.length) };
      }
    }

    // ── Planted events (fixed volume) ─────────────────────────────────────

    // The trigger: a single feature-flag change event at the leak onset.
    plantedLogs.push(
      makeLog({
        timestampMs: flagFlipMs,
        serviceName: SUBJECT_SERVICE,
        severityText: 'INFO',
        body: FLAG_FLIP_BODY,
        resourceAttributes: {
          'service.name': SUBJECT_SERVICE,
          'k8s.deployment.name': SUBJECT_SERVICE,
        },
        logAttributes: {
          'event.name': 'feature_flag.update',
          'feature_flag.key': FLAG_KEY,
          'feature_flag.variant': '100%',
        },
      }),
    );

    // Innocent notification-service rollout (near the VISIBLE onset).
    const notifyDeployMs = nowMs - NOTIFY_DEPLOY_AGO_MS;
    plantedLogs.push(
      makeLog({
        timestampMs: notifyDeployMs,
        serviceName: NOTIFY_SERVICE,
        severityText: 'INFO',
        body: `Deployment notification-service rolling update started: version ${NOTIFY_OLD_VERSION} -> ${NOTIFY_NEW_VERSION} (target ${NOTIFY_POD_COUNT} replicas)`,
        resourceAttributes: {
          'service.name': NOTIFY_SERVICE,
          'k8s.deployment.name': NOTIFY_SERVICE,
        },
        logAttributes: {
          'event.name': 'deployment.rollout',
          'service.version': NOTIFY_NEW_VERSION,
        },
      }),
    );
    for (let pod = 0; pod < NOTIFY_POD_COUNT; pod++) {
      plantedLogs.push(
        makeLog({
          timestampMs: notifyDeployMs + pod * NOTIFY_ROLLOUT_STAGGER_MS,
          serviceName: NOTIFY_SERVICE,
          severityText: 'INFO',
          body: `Pod ${notifyPods[pod]['k8s.pod.name']} updated to version ${NOTIFY_NEW_VERSION} (${pod + 1}/${NOTIFY_POD_COUNT} pods updated)`,
          resourceAttributes: notifyPods[pod],
          logAttributes: {
            'event.name': 'deployment.rollout',
            'service.version': NOTIFY_NEW_VERSION,
            'k8s.pod.name': notifyPods[pod]['k8s.pod.name'],
          },
        }),
      );
    }
    plantedLogs.push(
      makeLog({
        timestampMs:
          notifyDeployMs + NOTIFY_POD_COUNT * NOTIFY_ROLLOUT_STAGGER_MS,
        serviceName: NOTIFY_SERVICE,
        severityText: 'INFO',
        body: `Rollout notification-service completed: ${NOTIFY_POD_COUNT}/${NOTIFY_POD_COUNT} pods updated to version ${NOTIFY_NEW_VERSION}`,
        resourceAttributes: {
          'service.name': NOTIFY_SERVICE,
          'k8s.deployment.name': NOTIFY_SERVICE,
        },
        logAttributes: {
          'event.name': 'deployment.rollout',
          'service.version': NOTIFY_NEW_VERSION,
        },
      }),
    );

    // Nightly batch markers bracketing the inventory CPU spike.
    plantedLogs.push(
      makeLog({
        timestampMs: nowMs - BATCH_START_AGO_MS,
        serviceName: NEIGHBOR_SERVICE,
        severityText: 'INFO',
        body: 'Nightly inventory reconciliation batch started (full-catalog scan)',
        resourceAttributes: { 'service.name': NEIGHBOR_SERVICE },
        logAttributes: { 'event.name': 'batch.reconciliation.start' },
      }),
      makeLog({
        timestampMs: nowMs - BATCH_END_AGO_MS,
        serviceName: NEIGHBOR_SERVICE,
        severityText: 'INFO',
        body: 'Nightly inventory reconciliation batch completed in 900s (2,314,882 SKUs)',
        resourceAttributes: { 'service.name': NEIGHBOR_SERVICE },
        logAttributes: { 'event.name': 'batch.reconciliation.end' },
      }),
    );

    if (logs.length || plantedLogs.length) {
      yield { traces: [], logs: [...logs, ...plantedLogs] };
    }
  },
  groundTruth,
};
