/**
 * metric-saturation scenario.
 *
 * Story: recommendation-service (an allocation-heavy JVM ML scorer) has a slow
 * heap memory leak — an unbounded candidate/embedding cache. Over ~90 minutes
 * the G1 Old Gen heap climbs toward the ~2GB limit; full-GC pause time grows a
 * heavy tail that stalls request handling, and the pod OOM-restarts on a
 * cadence (heap drops back to baseline, then climbs again). Requests mostly
 * still succeed (degraded fallback ranking), with only mildly elevated latency
 * and occasional 503s at restart.
 *
 * The leak -> GC-pause -> latency -> restart chain lives ONLY in metrics:
 *   - Gauge  process.runtime.jvm.memory.used : sawtooth heap (the leak).
 *   - Gauge  system.cpu.utilization          : flat/healthy (rules out CPU).
 *   - Sum    k8s.pod.restarts                 : cumulative; rate = restart storm.
 *   - Sum    jvm.gc.collections               : cumulative; Old-Gen accelerates.
 *   - Histogram            http.server.request.duration : latency shifts up.
 *   - ExponentialHistogram jvm.gc.pause                 : heavy tail (mechanism).
 *   - Summary db.client.operation.duration (inventory-service) : stable decoy.
 *
 * Histograms use DELTA temporality (each scrape point = that window's
 * distribution) so the in-window shift is directly readable.
 *
 * Distractors: a coincidental 1.43.1 deploy ~40 min ago (the leak predates it),
 * flat CPU, and a stable neighbor Summary that cannot be re-aggregated into the
 * incident window.
 *
 * What a successful agent does:
 *   1. Notices trace latency is only mildly elevated and 503s are generic —
 *      the cause is not in traces/logs.
 *   2. Pulls the memory gauge and sees the climbing sawtooth on
 *      recommendation-service.
 *   3. Correlates it with the GC-pause exponential-histogram tail and the
 *      latency-histogram shift.
 *   4. Reads the cumulative restart/GC counters as a rate to confirm the
 *      restart cadence.
 *   5. Rules out the deploy (leak predates it), CPU (flat), and the neighbor
 *      db.client Summary (stable, unrelated, non-re-aggregatable).
 */
import { makeLog } from '@/generators/logs';
import {
  bucketize,
  expBucketize,
  makeExponentialHistogram,
  makeGauge,
  makeHistogram,
  makeSum,
  makeSummary,
} from '@/generators/metrics';
import {
  buildResourcePool,
  envoyAccessLog,
  normalizeSeverityText,
  pickResource,
  serviceOpsDebugLog,
  spreadTimestamp,
  upstreamHealthProbeLog,
} from '@/generators/templates';
import { makeSpan, msToNs, newSpanId, newTraceId } from '@/generators/traces';
import type {
  ExponentialHistogramMetricRow,
  GaugeMetricRow,
  HistogramMetricRow,
  LogRow,
  SummaryMetricRow,
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

const SUBJECT_SERVICE = 'recommendation-service';
const NEIGHBOR_SERVICE = 'inventory-service';
const PROXY_SERVICE = 'frontend-proxy';

// ─── Time model ───────────────────────────────────────────────────────────
// 2-hour window, metrics scraped every 120s (a lightweight cadence — one point
// per series every other minute keeps the scenario solvable in fewer queries).
// The leak begins 90 min before `now`; a fill cycle (baseline -> limit) takes
// ~22 min, giving ~4 restart sawtooth cycles across the incident. A single pod
// carries the leak/restart story (no per-pod fan-out for the agent to chase).
// Deploy distractor lands 40 min ago — AFTER the leak already started, so it
// provably isn't the cause.

const HISTORY_WINDOW_MS = 2 * 60 * 60 * 1000;
const SCRAPE_INTERVAL_MS = 120 * 1000;
const LEAK_DURATION_MS = 90 * 60 * 1000;
const FILL_CYCLE_MS = 22 * 60 * 1000;
const DEPLOY_AGO_MS = 40 * 60 * 1000;
const POD_STAGGER_MS = 7 * 60 * 1000;

const POD_COUNT = 1;

// Heap (MB).
const HEAP_BASE_MB = 600;
const HEAP_LIMIT_MB = 1950;

// GC collection rates (per minute, cumulative counters).
const YOUNG_GC_PER_MIN = 8;
const OLD_GC_PER_MIN_BASE = 0.2;
const OLD_GC_PER_MIN_LEAK = 3.0;

// Latency histogram explicit bounds (milliseconds).
const LATENCY_BOUNDS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const LATENCY_SAMPLES_PER_SCRAPE = 200;

// GC-pause exponential-histogram scale (base = 2^(2^-scale)).
const GC_PAUSE_EXP_SCALE = 2;

// ─── Trace/log floor volumes ────────────────────────────────────────────────
// Kept deliberately modest: the load-bearing signal is metrics-only, so the
// trace/log floor exists just to make traces/logs look "mostly normal". A
// smaller, less varied floor keeps the agent from spelunking log noise instead
// of reading the metrics.

const TOTAL_RECO_TRACES = 250_000;
const TOTAL_LOGS = 500_000;

const RECO_MODELS = ['als_v3', 'content_v2', 'hybrid_v1'] as const;

// Log template mix for the noise floor (weights are relative). Intentionally
// lean — ops chatter plus proxy access/probe lines. No heartbeat memory-as-log
// decoy: the memory signal lives in the gauge metric, not a log field.
const LOG_MIX = [
  { value: 'reco_ops', weight: 60 },
  { value: 'envoy', weight: 25 },
  { value: 'health_probe', weight: 15 },
] as const;

type Rng = GenerateContext['rng'];

// ─── Heap / pressure model ──────────────────────────────────────────────────

/** Per-pod leak-phase origin (staggered so pods don't restart in lockstep). */
function podLeakStartMs(nowMs: number, pod: number): number {
  return nowMs - LEAK_DURATION_MS + pod * POD_STAGGER_MS;
}

/** Heap used (MB) for a pod at time `t`, plus its cumulative restart count. */
function heapState(
  nowMs: number,
  pod: number,
  t: number,
  jitterMb: number,
): { usedMb: number; restarts: number } {
  const leakStart = podLeakStartMs(nowMs, pod);
  if (t < leakStart) {
    // Healthy: stable baseline with a small young-gen oscillation.
    return { usedMb: HEAP_BASE_MB + jitterMb, restarts: 0 };
  }
  const elapsed = t - leakStart;
  const cyclePos = elapsed % FILL_CYCLE_MS;
  const frac = cyclePos / FILL_CYCLE_MS;
  const usedMb =
    HEAP_BASE_MB + frac * (HEAP_LIMIT_MB - HEAP_BASE_MB) + jitterMb;
  const restarts = Math.floor(elapsed / FILL_CYCLE_MS);
  return { usedMb, restarts };
}

/** Max heap fullness across pods at `t`, clamped to [0,1]. Pre-leak ≈ 0. */
function heapPressure(nowMs: number, t: number): number {
  let maxUsed = HEAP_BASE_MB;
  for (let pod = 0; pod < POD_COUNT; pod++) {
    const { usedMb } = heapState(nowMs, pod, t, 0);
    if (usedMb > maxUsed) maxUsed = usedMb;
  }
  const p = (maxUsed - HEAP_BASE_MB) / (HEAP_LIMIT_MB - HEAP_BASE_MB);
  return Math.max(0, Math.min(1, p));
}

// ─── Metric generation ──────────────────────────────────────────────────────

function generateMetrics(rng: Rng, nowMs: number): MetricBatch {
  const windowStart = nowMs - HISTORY_WINDOW_MS;
  const scrapeCount = Math.floor(HISTORY_WINDOW_MS / SCRAPE_INTERVAL_MS);

  const gauge: GaugeMetricRow[] = [];
  const sum: SumMetricRow[] = [];
  const histogram: HistogramMetricRow[] = [];
  const exponentialHistogram: ExponentialHistogramMetricRow[] = [];
  const summary: SummaryMetricRow[] = [];

  // Cumulative counters (never reset within the window — aggregated view).
  let cumRestarts = 0;
  const prevRestartByPod = new Array<number>(POD_COUNT).fill(0);
  let cumYoungGc = 0;
  let cumOldGc = 0;

  const resource = (pod: number): Record<string, string> => ({
    'service.name': SUBJECT_SERVICE,
    'service.namespace': 'production',
    'k8s.namespace.name': 'production',
    'k8s.pod.name': `${SUBJECT_SERVICE}-pod-${pod}`,
    'k8s.deployment.name': SUBJECT_SERVICE,
  });

  for (let i = 0; i < scrapeCount; i++) {
    const t = windowStart + i * SCRAPE_INTERVAL_MS;
    const pressure = heapPressure(nowMs, t);

    // ── Gauge: per-pod heap + service-level CPU ──────────────────────────
    for (let pod = 0; pod < POD_COUNT; pod++) {
      const jitter = rng.range(0, 120); // young-gen oscillation
      const { usedMb, restarts } = heapState(nowMs, pod, t, jitter);
      gauge.push(
        makeGauge({
          timeUnixMs: t,
          serviceName: SUBJECT_SERVICE,
          metricName: 'process.runtime.jvm.memory.used',
          metricUnit: 'By',
          metricDescription: 'JVM heap memory used',
          value: Math.round(usedMb * 1024 * 1024),
          resourceAttributes: resource(pod),
          attributes: {
            'jvm.memory.type': 'heap',
            'jvm.memory.pool.name': 'G1 Old Gen',
          },
        }),
      );
      // Count new restarts since the previous scrape for this pod.
      if (restarts > prevRestartByPod[pod]) {
        cumRestarts += restarts - prevRestartByPod[pod];
        prevRestartByPod[pod] = restarts;
      }
    }

    // Flat, healthy CPU — the "not CPU" distractor.
    gauge.push(
      makeGauge({
        timeUnixMs: t,
        serviceName: SUBJECT_SERVICE,
        metricName: 'system.cpu.utilization',
        metricUnit: '1',
        metricDescription: 'CPU utilization (0-1)',
        value: Number(rng.range(0.3, 0.42).toFixed(3)),
        resourceAttributes: resource(0),
        attributes: { state: 'used' },
      }),
    );

    // ── Sum: cumulative restart + GC-collection counters ─────────────────
    sum.push(
      makeSum({
        timeUnixMs: t,
        serviceName: SUBJECT_SERVICE,
        metricName: 'k8s.pod.restarts',
        metricDescription: 'Cumulative pod restarts',
        value: cumRestarts,
        resourceAttributes: resource(0),
      }),
    );

    const minutes = SCRAPE_INTERVAL_MS / 60_000;
    cumYoungGc += YOUNG_GC_PER_MIN * minutes;
    cumOldGc +=
      (OLD_GC_PER_MIN_BASE +
        (OLD_GC_PER_MIN_LEAK - OLD_GC_PER_MIN_BASE) * pressure) *
      minutes;
    sum.push(
      makeSum({
        timeUnixMs: t,
        serviceName: SUBJECT_SERVICE,
        metricName: 'jvm.gc.collections',
        metricDescription: 'Cumulative GC collections',
        value: Math.round(cumYoungGc),
        resourceAttributes: resource(0),
        attributes: { 'gc.name': 'G1 Young Generation' },
      }),
    );
    sum.push(
      makeSum({
        timeUnixMs: t,
        serviceName: SUBJECT_SERVICE,
        metricName: 'jvm.gc.collections',
        metricDescription: 'Cumulative GC collections',
        value: Math.round(cumOldGc),
        resourceAttributes: resource(0),
        attributes: { 'gc.name': 'G1 Old Generation' },
      }),
    );

    // ── Histogram: request-duration distribution (delta temporality) ─────
    const latencySamples: number[] = [];
    const pSlow = 0.01 + 0.12 * pressure;
    for (let s = 0; s < LATENCY_SAMPLES_PER_SCRAPE; s++) {
      latencySamples.push(
        rng.next() < pSlow ? rng.range(500, 3000) : rng.range(8, 120),
      );
    }
    histogram.push(
      makeHistogram({
        timeUnixMs: t,
        serviceName: SUBJECT_SERVICE,
        metricName: 'http.server.request.duration',
        metricUnit: 'ms',
        metricDescription: 'HTTP server request duration',
        aggregationTemporality: 1,
        ...bucketize(latencySamples, LATENCY_BOUNDS_MS),
        explicitBounds: [...LATENCY_BOUNDS_MS],
        resourceAttributes: resource(0),
        attributes: { 'http.route': '/score' },
      }),
    );

    // ── Exponential histogram: GC pause durations (delta temporality) ────
    const pauseSamples: number[] = [];
    const youngPauses = rng.intRange(6, 12);
    for (let g = 0; g < youngPauses; g++) pauseSamples.push(rng.range(4, 25));
    const fullPauses = Math.round(pressure * rng.range(2, 5));
    for (let g = 0; g < fullPauses; g++)
      pauseSamples.push(rng.range(400, 2200));
    exponentialHistogram.push(
      makeExponentialHistogram({
        timeUnixMs: t,
        serviceName: SUBJECT_SERVICE,
        metricName: 'jvm.gc.pause',
        metricUnit: 'ms',
        metricDescription: 'GC pause duration',
        aggregationTemporality: 1,
        ...expBucketize(pauseSamples, GC_PAUSE_EXP_SCALE),
        resourceAttributes: resource(0),
        attributes: {},
      }),
    );

    // ── Summary: neighbor db.client latency (stable decoy) ───────────────
    const p50 = rng.range(7, 9);
    const p95 = rng.range(38, 44);
    const p99 = rng.range(85, 95);
    const sCount = rng.intRange(400, 600);
    summary.push(
      makeSummary({
        timeUnixMs: t,
        serviceName: NEIGHBOR_SERVICE,
        metricName: 'db.client.operation.duration',
        metricUnit: 'ms',
        metricDescription: 'DB client operation duration',
        count: sCount,
        sum: Math.round(sCount * p50 * 1.4),
        quantiles: [
          { quantile: 0.5, value: Number(p50.toFixed(2)) },
          { quantile: 0.95, value: Number(p95.toFixed(2)) },
          { quantile: 0.99, value: Number(p99.toFixed(2)) },
        ],
        resourceAttributes: {
          'service.name': NEIGHBOR_SERVICE,
          'k8s.namespace.name': 'production',
        },
        attributes: { 'db.system': 'postgresql' },
      }),
    );
  }

  return { gauge, sum, histogram, exponentialHistogram, summary };
}

// ─── Trace/log floor ────────────────────────────────────────────────────────

/** Ambiguous restart-adjacent log lines (hint at restarts, not the cause). */
const RESTART_LOG_LINES = [
  'Liveness probe failed: HTTP probe failed with statuscode: 503',
  'Received SIGTERM, shutting down gracefully',
  'readiness probe failed: context deadline exceeded',
  'Container recommendation-service restarted',
] as const;

function versionAtTime(nowMs: number, t: number): string {
  return t >= nowMs - DEPLOY_AGO_MS ? '1.43.1' : '1.43.0';
}

export const metricSaturationScenario: Scenario = {
  name: 'metric-saturation',
  maxTurns: 25,
  agentPrompt: groundTruth.agentPrompt,
  description:
    'recommendation-service JVM heap leak: memory gauge sawtooth -> GC-pause (exp-histogram) tail -> latency-histogram shift -> pod-restart (cumulative sum) cadence. Root cause is metrics-only; traces/logs show just mild latency + generic 503s. Exercises all five metric types (gauge/sum/histogram/exp-histogram/summary). Distractors: coincidental deploy, flat CPU, stable neighbor Summary.',
  buildSystemPrompt: ctx =>
    buildInvestigationSystemPrompt(
      'metric-saturation',
      ctx.anchorTimeIso,
      ctx.variant,
      ctx.maxTurns,
      {
        signalsNote:
          '- Metrics: a HyperDX metric source is available (gauge, sum, ' +
          'histogram, exponential histogram, and summary). Use the metric ' +
          'tools to explore it alongside traces and logs.',
      },
    ),
  *generate(ctx): Iterable<ScenarioBatch> {
    const { rng, nowMs } = ctx;
    const factor = ctx.volumeFactor ?? 1;
    const batchSize = ctx.batchSize ?? 10_000;
    const windowStart = nowMs - HISTORY_WINDOW_MS;

    // Metrics first (fixed volume — the planted signal never scales).
    const metrics = generateMetrics(rng, nowMs);
    yield { traces: [], logs: [], metrics };

    const resourcePool = buildResourcePool({
      rng,
      services: [SUBJECT_SERVICE, NEIGHBOR_SERVICE, PROXY_SERVICE],
      instancesPerService: 12,
    });

    // ── Traces: recommendation.score server spans ────────────────────────
    const totalTraces = Math.max(50, Math.round(TOTAL_RECO_TRACES * factor));
    const traces: TraceRow[] = [];
    for (let i = 0; i < totalTraces; i++) {
      const t = spreadTimestamp(i, totalTraces, windowStart, HISTORY_WINDOW_MS);
      const pressure = heapPressure(nowMs, t);
      const pSlow = 0.01 + 0.12 * pressure;
      const p503 = 0.004 * pressure; // rare, only under pressure
      const roll = rng.next();
      const isError = roll < p503;
      const isSlow = !isError && rng.next() < pSlow;
      const durationMs = isError
        ? rng.range(9000, 10000)
        : isSlow
          ? rng.range(500, 3000)
          : rng.range(8, 120);

      const traceId = newTraceId(rng);
      const spanId = newSpanId(rng);
      const base = pickResource(rng, resourcePool, SUBJECT_SERVICE);
      const resourceAttributes = {
        ...base,
        'service.version': versionAtTime(nowMs, t),
      };
      traces.push(
        makeSpan({
          rng,
          timestampMs: t,
          traceId,
          spanId,
          spanName: 'recommendation.score',
          spanKind: 'SPAN_KIND_SERVER',
          serviceName: SUBJECT_SERVICE,
          durationNs: msToNs(durationMs),
          statusCode: isError ? 'STATUS_CODE_ERROR' : 'STATUS_CODE_OK',
          statusMessage: isError ? 'context deadline exceeded' : '',
          resourceAttributes,
          spanAttributes: {
            'reco.model': rng.pick(RECO_MODELS),
            'reco.candidates': String(rng.intRange(10, 500)),
            'reco.returned': String(rng.intRange(5, 25)),
            'http.route': '/score',
            'http.request.method': 'POST',
            'http.response.status_code': isError ? '503' : '200',
          },
        }),
      );
      if (traces.length >= batchSize) {
        yield { traces: traces.splice(0, traces.length), logs: [] };
      }
    }
    if (traces.length)
      yield { traces: traces.splice(0, traces.length), logs: [] };

    // ── Logs: ops chatter + proxy access/probe + restart hints ──────────
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
      let service = SUBJECT_SERVICE;
      let body: string;
      let attrs: Record<string, string>;
      let sevText: string;

      if (kind === 'reco_ops') {
        const tmpl = serviceOpsDebugLog({
          rng,
          nowMs: t,
          serviceName: SUBJECT_SERVICE,
        });
        body = tmpl.body;
        attrs = tmpl.attrs;
        sevText = tmpl.level;
      } else if (kind === 'envoy') {
        service = PROXY_SERVICE;
        const tmpl = envoyAccessLog({ rng, nowMs: t });
        body = tmpl.body;
        attrs = tmpl.attrs;
        sevText = 'info';
      } else {
        service = PROXY_SERVICE;
        const tmpl = upstreamHealthProbeLog({ rng, nowMs: t });
        body = tmpl.body;
        attrs = tmpl.attrs;
        sevText = 'info';
      }

      logs.push(
        makeLog({
          timestampMs: t,
          serviceName: service,
          severityText: normalizeSeverityText(sevText),
          body,
          resourceAttributes: pickResource(rng, resourcePool, service),
          logAttributes: { ...attrs, _severity_raw: sevText },
        }),
      );
      if (logs.length >= batchSize) {
        yield { traces: [], logs: logs.splice(0, logs.length) };
      }
    }

    // ── Restart-adjacent hint logs (one per restart event, ambiguous) ────
    for (let pod = 0; pod < POD_COUNT; pod++) {
      const leakStart = podLeakStartMs(nowMs, pod);
      for (
        let restartMs = leakStart + FILL_CYCLE_MS;
        restartMs <= nowMs;
        restartMs += FILL_CYCLE_MS
      ) {
        for (const line of RESTART_LOG_LINES) {
          logs.push(
            makeLog({
              timestampMs: restartMs + rng.intRange(0, 2000),
              serviceName: SUBJECT_SERVICE,
              severityText: 'WARN',
              body: line,
              resourceAttributes: {
                'service.name': SUBJECT_SERVICE,
                'k8s.pod.name': `${SUBJECT_SERVICE}-pod-${pod}`,
              },
              logAttributes: {
                'event.name': 'pod.lifecycle',
                'k8s.pod.name': `${SUBJECT_SERVICE}-pod-${pod}`,
              },
            }),
          );
        }
      }
    }

    // ── Coincidental deploy log (the "blame the deploy" distractor) ──────
    logs.push(
      makeLog({
        timestampMs: nowMs - DEPLOY_AGO_MS,
        serviceName: SUBJECT_SERVICE,
        severityText: 'INFO',
        body: 'Deployment recommendation-service rolled out: version 1.43.0 -> 1.43.1',
        resourceAttributes: {
          'service.name': SUBJECT_SERVICE,
          'service.version': '1.43.1',
          'k8s.deployment.name': SUBJECT_SERVICE,
        },
        logAttributes: {
          'event.name': 'deployment.rollout',
          'service.version': '1.43.1',
        },
      }),
    );

    if (logs.length) yield { traces: [], logs };
  },
  groundTruth,
};
