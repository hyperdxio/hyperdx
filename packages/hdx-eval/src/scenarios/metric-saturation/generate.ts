/**
 * metric-saturation scenario.
 *
 * Story: recommendation-service (an allocation-heavy JVM ML scorer) has a slow
 * heap memory leak — an unbounded candidate/embedding cache. Over ~90 minutes
 * the G1 Old Gen heap on each of its 3 pods climbs toward the ~2GB limit
 * (staggered ~7 min apart); full-GC pause time grows a heavy tail that stalls
 * request handling, and each pod OOM-restarts on a ~22-min cadence (heap drops
 * back to baseline, then climbs again). Requests mostly still succeed
 * (degraded fallback ranking), with only mildly elevated latency and
 * occasional 503s surfacing at the frontend proxy.
 *
 * The leak -> GC-pause -> latency -> restart chain lives ONLY in metrics —
 * and reading it requires real metric work, not a one-shot query:
 *   - Gauge  process.runtime.jvm.memory.used : per-pod, per-POOL. Only the
 *     `G1 Old Gen` pool leaks; Eden oscillates and Survivor/Metaspace are
 *     flat, so a naive avg() across pools dilutes the sawtooth. The pods
 *     restart out of phase, so the service-level aggregate is a blurred
 *     climb — the clean sawtooth only appears grouped by k8s.pod.name.
 *   - Gauge  jvm.threads.count               : rises WITH the incident but is
 *     a downstream symptom of GC stalls (threads pile up), not the cause.
 *   - Gauge  system.cpu.utilization          : flat/healthy (rules out CPU).
 *   - Sum    k8s.pod.restarts                 : cumulative per pod; the rate
 *     reveals a staggered restart storm.
 *   - Sum    jvm.gc.collections               : cumulative; Old-Gen accelerates.
 *   - Histogram            http.server.request.duration : latency shifts up.
 *   - ExponentialHistogram jvm.gc.pause                 : heavy tail (mechanism).
 *   - Summary db.client.operation.duration (inventory-service) : stable decoy.
 *
 * Histograms use DELTA temporality (each scrape point = that window's
 * distribution) so the in-window shift is directly readable.
 *
 * Discovery is non-trivial: healthy baseline metric sets exist for
 * frontend-proxy (request histogram/count + CPU), inventory-service (CPU +
 * non-JVM process.memory.usage + the Summary decoy), and search-service — a
 * JVM TWIN with the same metric names (memory pools, gc.pause,
 * gc.collections) that stays healthy throughout. A keyword hunt for
 * "jvm"/"memory" returns two services; isolating the leaker requires
 * grouping/filtering by service, pool, and pod.
 *
 * Distractors: a coincidental 1.43.1 deploy 75 min ago (the leak started
 * ~90 min ago — ruling it out requires comparing onsets at scrape
 * granularity), the correlated-but-symptomatic thread-count gauge, flat CPU,
 * the healthy JVM twin, and a stable neighbor Summary that cannot be
 * re-aggregated into the incident window.
 *
 * The prompt is blinded: the user reports slow/missing storefront
 * recommendations and upstream 503s at frontend-proxy. The agent must
 * localize recommendation-service first — via error/latency spans in traces
 * or the planted proxy access-log lines whose upstream cluster is
 * recommendation-service. Neither path reveals the memory/GC cause.
 *
 * What a successful agent does:
 *   1. Localizes the failing upstream (recommendation-service) from proxy
 *      503 access logs or cross-service trace aggregates.
 *   2. Notices trace latency is only mildly elevated and 503s are generic —
 *      the cause is not in traces/logs.
 *   3. Discovers the JVM metrics, isolates the leaking G1 Old Gen pool on
 *      recommendation-service (not search-service), and groups by pod to
 *      see the staggered sawtooth.
 *   4. Correlates it with the GC-pause exponential-histogram tail and the
 *      latency-histogram shift.
 *   5. Reads the cumulative restart/GC counters as a rate to confirm the
 *      restart cadence.
 *   6. Rules out the deploy (leak onset predates it), CPU (flat), thread
 *      growth (symptom of GC stalls, not cause), the healthy search-service
 *      JVM twin, and the neighbor db.client Summary (stable, unrelated,
 *      non-re-aggregatable).
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
/** Healthy JVM twin — same metric names as the subject, no leak. */
const JVM_TWIN_SERVICE = 'search-service';

// ─── Time model ───────────────────────────────────────────────────────────
// 2-hour window, metrics scraped every 120s (a lightweight cadence — one point
// per series every other minute keeps the scenario solvable in fewer queries).
// The leak begins 90 min before `now`; a fill cycle (baseline -> limit) takes
// ~22 min, giving ~4 restart sawtooth cycles per pod across the incident.
// Three pods carry the leak with staggered onsets (~7 min apart), so the
// service-level heap aggregate is a blurred climb — the sawtooth is only
// clean per pod. Deploy distractor lands 75 min ago — AFTER the leak already
// started (90 min ago), so it provably isn't the cause, but ruling it out
// requires comparing the onsets, not eyeballing a huge gap.

const HISTORY_WINDOW_MS = 2 * 60 * 60 * 1000;
const SCRAPE_INTERVAL_MS = 120 * 1000;
const LEAK_DURATION_MS = 90 * 60 * 1000;
const FILL_CYCLE_MS = 22 * 60 * 1000;
const DEPLOY_AGO_MS = 75 * 60 * 1000;
const POD_STAGGER_MS = 7 * 60 * 1000;

const POD_COUNT = 3;

// Heap (MB) — G1 Old Gen, the leaking pool.
const HEAP_BASE_MB = 600;
const HEAP_LIMIT_MB = 1950;

// Healthy pools on the subject (and the same shape on the JVM twin).
const EDEN_MIN_MB = 80;
const EDEN_MAX_MB = 320;
const SURVIVOR_MIN_MB = 24;
const SURVIVOR_MAX_MB = 48;
const METASPACE_MIN_MB = 176;
const METASPACE_MAX_MB = 188;

// Thread count — symptom gauge (threads pile up during GC stalls).
const THREADS_BASE = 42;
const THREADS_PRESSURE_RANGE = 90;

// GC collection rates (per minute, cumulative counters).
const YOUNG_GC_PER_MIN = 8;
const OLD_GC_PER_MIN_BASE = 0.2;
const OLD_GC_PER_MIN_LEAK = 3.0;

// Latency histogram explicit bounds (milliseconds).
const LATENCY_BOUNDS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const LATENCY_SAMPLES_PER_SCRAPE = 200;

// GC-pause exponential-histogram scale (base = 2^(2^-scale)).
const GC_PAUSE_EXP_SCALE = 2;

// Symptom intensity: with 3 staggered pods the MEAN pressure hovers around
// ~0.5 during the incident, so the slow-request multiplier is higher than a
// single-pod model to keep the same "mildly elevated" trace character.
const SLOW_BASE_P = 0.01;
const SLOW_PRESSURE_P = 0.18;
const ERROR_PRESSURE_P = 0.006;

// ─── Trace/log floor volumes ────────────────────────────────────────────────
// Kept deliberately modest: the load-bearing signal is metrics-only, so the
// trace/log floor exists just to make traces/logs look "mostly normal" and to
// give the blinded prompt a fair localization path (the subject must be
// findable among healthy neighbors, not the only service in the table).

const TOTAL_RECO_TRACES = 250_000;
const TOTAL_PROXY_TRACES = 80_000;
const TOTAL_TWIN_TRACES = 50_000;
const TOTAL_NEIGHBOR_TRACES = 40_000;
const TOTAL_LOGS = 500_000;

const RECO_MODELS = ['als_v3', 'content_v2', 'hybrid_v1'] as const;

// Log template mix for the noise floor (weights are relative). Intentionally
// lean — ops chatter plus proxy access/probe lines. No heartbeat memory-as-log
// decoy: the memory signal lives in the gauge metric, not a log field.
const LOG_MIX = [
  { value: 'reco_ops', weight: 45 },
  { value: 'envoy', weight: 25 },
  { value: 'health_probe', weight: 10 },
  { value: 'search_ops', weight: 12 },
  { value: 'inventory_ops', weight: 8 },
] as const;

type Rng = GenerateContext['rng'];

// ─── Heap / pressure model ──────────────────────────────────────────────────

/** Per-pod leak-phase origin (staggered so pods don't restart in lockstep). */
function podLeakStartMs(nowMs: number, pod: number): number {
  return nowMs - LEAK_DURATION_MS + pod * POD_STAGGER_MS;
}

/** Fill-cycle fraction [0,1) for a pod at time `t` (0 before its leak). */
function podHeapFrac(nowMs: number, pod: number, t: number): number {
  const leakStart = podLeakStartMs(nowMs, pod);
  if (t < leakStart) return 0;
  return ((t - leakStart) % FILL_CYCLE_MS) / FILL_CYCLE_MS;
}

/** Old Gen heap used (MB) for a pod at `t`, plus its cumulative restarts. */
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
  const frac = podHeapFrac(nowMs, pod, t);
  const usedMb =
    HEAP_BASE_MB + frac * (HEAP_LIMIT_MB - HEAP_BASE_MB) + jitterMb;
  const restarts = Math.floor(elapsed / FILL_CYCLE_MS);
  return { usedMb, restarts };
}

/**
 * Mean heap fullness across pods at `t`, clamped to [0,1]. Pre-leak ≈ 0.
 * Mean (not max): with 3 staggered pods a max would pin near 1.0 for most of
 * the incident and flatten the latency/503 correlation; the mean keeps a
 * visible in-window ebb and flow.
 */
function heapPressure(nowMs: number, t: number): number {
  let total = 0;
  for (let pod = 0; pod < POD_COUNT; pod++) {
    total += podHeapFrac(nowMs, pod, t);
  }
  return Math.max(0, Math.min(1, total / POD_COUNT));
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
  let cumYoungGc = 0;
  let cumOldGc = 0;
  let cumTwinYoungGc = 0;
  let cumTwinOldGc = 0;
  let cumProxyRequests = 0;

  const podResource = (pod: number): Record<string, string> => ({
    'service.name': SUBJECT_SERVICE,
    'service.namespace': 'production',
    'k8s.namespace.name': 'production',
    'k8s.pod.name': `${SUBJECT_SERVICE}-pod-${pod}`,
    'k8s.deployment.name': SUBJECT_SERVICE,
  });
  // Service-level resource (no pod) for aggregate series.
  const svcResource = (service: string): Record<string, string> => ({
    'service.name': service,
    'service.namespace': 'production',
    'k8s.namespace.name': 'production',
    'k8s.deployment.name': service,
  });
  const twinPodResource: Record<string, string> = {
    'service.name': JVM_TWIN_SERVICE,
    'service.namespace': 'production',
    'k8s.namespace.name': 'production',
    'k8s.pod.name': `${JVM_TWIN_SERVICE}-pod-0`,
    'k8s.deployment.name': JVM_TWIN_SERVICE,
  };

  const heapPoolGauge = (
    t: number,
    service: string,
    resourceAttributes: Record<string, string>,
    pool: string,
    usedMb: number,
    type: 'heap' | 'non_heap' = 'heap',
  ): GaugeMetricRow =>
    makeGauge({
      timeUnixMs: t,
      serviceName: service,
      metricName: 'process.runtime.jvm.memory.used',
      metricUnit: 'By',
      metricDescription: 'JVM memory used, by pool',
      value: Math.round(usedMb * 1024 * 1024),
      resourceAttributes,
      attributes: {
        'jvm.memory.type': type,
        'jvm.memory.pool.name': pool,
      },
    });

  for (let i = 0; i < scrapeCount; i++) {
    const t = windowStart + i * SCRAPE_INTERVAL_MS;
    const pressure = heapPressure(nowMs, t);
    const minutes = SCRAPE_INTERVAL_MS / 60_000;

    // ── Subject: per-pod heap pools + threads + restarts ─────────────────
    for (let pod = 0; pod < POD_COUNT; pod++) {
      const res = podResource(pod);
      const jitter = rng.range(0, 120); // young-gen oscillation
      const { usedMb, restarts } = heapState(nowMs, pod, t, jitter);
      const podFrac = podHeapFrac(nowMs, pod, t);

      // Only the Old Gen pool leaks; the other pools stay healthy, so an
      // un-grouped avg() across pools dilutes the sawtooth.
      gauge.push(
        heapPoolGauge(t, SUBJECT_SERVICE, res, 'G1 Old Gen', usedMb),
        heapPoolGauge(
          t,
          SUBJECT_SERVICE,
          res,
          'G1 Eden Space',
          rng.range(EDEN_MIN_MB, EDEN_MAX_MB),
        ),
        heapPoolGauge(
          t,
          SUBJECT_SERVICE,
          res,
          'G1 Survivor Space',
          rng.range(SURVIVOR_MIN_MB, SURVIVOR_MAX_MB),
        ),
        heapPoolGauge(
          t,
          SUBJECT_SERVICE,
          res,
          'Metaspace',
          rng.range(METASPACE_MIN_MB, METASPACE_MAX_MB),
          'non_heap',
        ),
      );

      // Symptom gauge: threads pile up while requests stall in full GCs.
      // Correlated with the incident but downstream of the cause.
      gauge.push(
        makeGauge({
          timeUnixMs: t,
          serviceName: SUBJECT_SERVICE,
          metricName: 'jvm.threads.count',
          metricUnit: '{thread}',
          metricDescription: 'JVM live thread count',
          value: Math.round(
            THREADS_BASE + podFrac * THREADS_PRESSURE_RANGE + rng.range(-4, 4),
          ),
          resourceAttributes: res,
          attributes: {},
        }),
      );

      // Cumulative per-pod restart counter (kubelet-style, never resets).
      sum.push(
        makeSum({
          timeUnixMs: t,
          serviceName: SUBJECT_SERVICE,
          metricName: 'k8s.pod.restarts',
          metricDescription: 'Cumulative pod restarts',
          value: restarts,
          resourceAttributes: res,
        }),
      );
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
        resourceAttributes: svcResource(SUBJECT_SERVICE),
        attributes: { state: 'used' },
      }),
    );

    // ── Subject: cumulative GC-collection counters (service-level) ───────
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
        resourceAttributes: svcResource(SUBJECT_SERVICE),
        attributes: { 'gc.name': 'G1 Young Generation' },
      }),
      makeSum({
        timeUnixMs: t,
        serviceName: SUBJECT_SERVICE,
        metricName: 'jvm.gc.collections',
        metricDescription: 'Cumulative GC collections',
        value: Math.round(cumOldGc),
        resourceAttributes: svcResource(SUBJECT_SERVICE),
        attributes: { 'gc.name': 'G1 Old Generation' },
      }),
    );

    // ── Subject: request-duration distribution (delta temporality) ───────
    const latencySamples: number[] = [];
    const pSlow = SLOW_BASE_P + SLOW_PRESSURE_P * pressure;
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
        resourceAttributes: svcResource(SUBJECT_SERVICE),
        attributes: { 'http.route': '/score' },
      }),
    );

    // ── Subject: GC pause durations (delta temporality) ──────────────────
    const pauseSamples: number[] = [];
    const youngPauses = rng.intRange(6, 12);
    for (let g = 0; g < youngPauses; g++) pauseSamples.push(rng.range(4, 25));
    const fullPauses = Math.round(pressure * rng.range(3, 7));
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
        resourceAttributes: svcResource(SUBJECT_SERVICE),
        attributes: {},
      }),
    );

    // ── JVM twin (search-service): same metric names, all healthy ────────
    gauge.push(
      heapPoolGauge(
        t,
        JVM_TWIN_SERVICE,
        twinPodResource,
        'G1 Old Gen',
        rng.range(430, 490),
      ),
      heapPoolGauge(
        t,
        JVM_TWIN_SERVICE,
        twinPodResource,
        'G1 Eden Space',
        rng.range(60, 260),
      ),
      heapPoolGauge(
        t,
        JVM_TWIN_SERVICE,
        twinPodResource,
        'G1 Survivor Space',
        rng.range(SURVIVOR_MIN_MB, SURVIVOR_MAX_MB),
      ),
      heapPoolGauge(
        t,
        JVM_TWIN_SERVICE,
        twinPodResource,
        'Metaspace',
        rng.range(150, 162),
        'non_heap',
      ),
      makeGauge({
        timeUnixMs: t,
        serviceName: JVM_TWIN_SERVICE,
        metricName: 'system.cpu.utilization',
        metricUnit: '1',
        metricDescription: 'CPU utilization (0-1)',
        value: Number(rng.range(0.22, 0.34).toFixed(3)),
        resourceAttributes: svcResource(JVM_TWIN_SERVICE),
        attributes: { state: 'used' },
      }),
    );
    cumTwinYoungGc += YOUNG_GC_PER_MIN * minutes;
    cumTwinOldGc += OLD_GC_PER_MIN_BASE * minutes;
    sum.push(
      makeSum({
        timeUnixMs: t,
        serviceName: JVM_TWIN_SERVICE,
        metricName: 'jvm.gc.collections',
        metricDescription: 'Cumulative GC collections',
        value: Math.round(cumTwinYoungGc),
        resourceAttributes: svcResource(JVM_TWIN_SERVICE),
        attributes: { 'gc.name': 'G1 Young Generation' },
      }),
      makeSum({
        timeUnixMs: t,
        serviceName: JVM_TWIN_SERVICE,
        metricName: 'jvm.gc.collections',
        metricDescription: 'Cumulative GC collections',
        value: Math.round(cumTwinOldGc),
        resourceAttributes: svcResource(JVM_TWIN_SERVICE),
        attributes: { 'gc.name': 'G1 Old Generation' },
      }),
    );
    const twinPauses: number[] = [];
    const twinYoung = rng.intRange(6, 12);
    for (let g = 0; g < twinYoung; g++) twinPauses.push(rng.range(4, 25));
    exponentialHistogram.push(
      makeExponentialHistogram({
        timeUnixMs: t,
        serviceName: JVM_TWIN_SERVICE,
        metricName: 'jvm.gc.pause',
        metricUnit: 'ms',
        metricDescription: 'GC pause duration',
        aggregationTemporality: 1,
        ...expBucketize(twinPauses, GC_PAUSE_EXP_SCALE),
        resourceAttributes: svcResource(JVM_TWIN_SERVICE),
        attributes: {},
      }),
    );

    // ── frontend-proxy: healthy request histogram + count + CPU ──────────
    const proxySamples: number[] = [];
    for (let s = 0; s < 100; s++) {
      proxySamples.push(
        rng.next() < 0.005 ? rng.range(200, 800) : rng.range(2, 80),
      );
    }
    histogram.push(
      makeHistogram({
        timeUnixMs: t,
        serviceName: PROXY_SERVICE,
        metricName: 'http.server.request.duration',
        metricUnit: 'ms',
        metricDescription: 'HTTP server request duration',
        aggregationTemporality: 1,
        ...bucketize(proxySamples, LATENCY_BOUNDS_MS),
        explicitBounds: [...LATENCY_BOUNDS_MS],
        resourceAttributes: svcResource(PROXY_SERVICE),
        attributes: {},
      }),
    );
    cumProxyRequests += rng.range(1150, 1250) * minutes;
    sum.push(
      makeSum({
        timeUnixMs: t,
        serviceName: PROXY_SERVICE,
        metricName: 'http.server.request.count',
        metricDescription: 'Cumulative HTTP requests served',
        value: Math.round(cumProxyRequests),
        resourceAttributes: svcResource(PROXY_SERVICE),
      }),
    );
    gauge.push(
      makeGauge({
        timeUnixMs: t,
        serviceName: PROXY_SERVICE,
        metricName: 'system.cpu.utilization',
        metricUnit: '1',
        metricDescription: 'CPU utilization (0-1)',
        value: Number(rng.range(0.18, 0.3).toFixed(3)),
        resourceAttributes: svcResource(PROXY_SERVICE),
        attributes: { state: 'used' },
      }),
    );

    // ── inventory-service: Summary decoy + flat CPU + non-JVM memory ─────
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
    gauge.push(
      makeGauge({
        timeUnixMs: t,
        serviceName: NEIGHBOR_SERVICE,
        metricName: 'system.cpu.utilization',
        metricUnit: '1',
        metricDescription: 'CPU utilization (0-1)',
        value: Number(rng.range(0.25, 0.35).toFixed(3)),
        resourceAttributes: svcResource(NEIGHBOR_SERVICE),
        attributes: { state: 'used' },
      }),
      makeGauge({
        timeUnixMs: t,
        serviceName: NEIGHBOR_SERVICE,
        metricName: 'process.memory.usage',
        metricUnit: 'By',
        metricDescription: 'Process resident memory',
        value: Math.round(rng.range(340, 370) * 1024 * 1024),
        resourceAttributes: svcResource(NEIGHBOR_SERVICE),
        attributes: {},
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

/**
 * Planted frontend-proxy access-log line whose upstream cluster is
 * recommendation-service — the log-side localization path for the blinded
 * prompt. Mirrors the generic envoy body shape but names the failing
 * upstream, an upstream-timeout flag, and a ~10s total time.
 */
function proxyUpstream503Log(rng: Rng, t: number): LogRow {
  const ts = new Date(t).toISOString();
  const totalMs = rng.intRange(9000, 10000);
  const upstreamIp = `10.${rng.intRange(0, 256)}.${rng.intRange(0, 256)}.${rng.intRange(1, 254)}`;
  const sourceIp = `34.${rng.intRange(100, 256)}.${rng.intRange(0, 256)}.${rng.intRange(1, 254)}`;
  const body =
    `[${ts}] "GET /api/recommendations HTTP/1.1" 503 UT via_upstream - "-" ` +
    `0 91 ${totalMs} ${totalMs - rng.intRange(1, 40)} "-" "Mozilla/5.0" ` +
    `"-" "frontend-proxy:8080" "${upstreamIp}:8080" recommendation-service ` +
    `${sourceIp}:0 ${upstreamIp}:8080 - - default`;
  return makeLog({
    timestampMs: t,
    serviceName: PROXY_SERVICE,
    severityText: 'WARN',
    body,
    resourceAttributes: {
      'service.name': PROXY_SERVICE,
      'k8s.namespace.name': 'production',
    },
    logAttributes: {
      'event.name': 'proxy.access',
      'http.method': 'GET',
      'url.path': '/api/recommendations',
      'http.status_code': '503',
      'response.flags': 'UT',
      'upstream.cluster': 'recommendation-service',
      _severity_raw: 'warning',
    },
  });
}

export const metricSaturationScenario: Scenario = {
  name: 'metric-saturation',
  maxTurns: 25,
  agentPrompt: groundTruth.agentPrompt,
  description:
    'recommendation-service JVM heap leak behind a blinded prompt (storefront symptom at frontend-proxy): per-pod/per-pool memory-gauge sawtooth -> GC-pause (exp-histogram) tail -> latency-histogram shift -> staggered pod-restart (cumulative sum) cadence. Root cause is metrics-only; traces/logs show just mild latency + generic 503s. Exercises all five metric types plus discovery/group-by (healthy JVM twin on search-service, pool-split heap gauge, 3 out-of-phase pods). Distractors: coincidental deploy 15 min after leak onset, correlated-but-symptomatic thread-count gauge, flat CPU, healthy JVM twin, stable neighbor Summary.',
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
      services: [
        SUBJECT_SERVICE,
        NEIGHBOR_SERVICE,
        PROXY_SERVICE,
        JVM_TWIN_SERVICE,
      ],
      instancesPerService: 12,
    });

    // ── Traces: recommendation.score server spans ────────────────────────
    const totalTraces = Math.max(50, Math.round(TOTAL_RECO_TRACES * factor));
    const traces: TraceRow[] = [];
    for (let i = 0; i < totalTraces; i++) {
      const t = spreadTimestamp(i, totalTraces, windowStart, HISTORY_WINDOW_MS);
      const pressure = heapPressure(nowMs, t);
      const pSlow = SLOW_BASE_P + SLOW_PRESSURE_P * pressure;
      const p503 = ERROR_PRESSURE_P * pressure; // rare, only under pressure
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

    // ── Traces: healthy floors for the neighbors (localization haystack) ─
    const neighborFloors: {
      service: string;
      spanName: string;
      total: number;
      route: string;
      maxMs: number;
    }[] = [
      {
        service: PROXY_SERVICE,
        spanName: 'proxy.request',
        total: TOTAL_PROXY_TRACES,
        route: '/api/*',
        maxMs: 150,
      },
      {
        service: JVM_TWIN_SERVICE,
        spanName: 'search.query',
        total: TOTAL_TWIN_TRACES,
        route: '/api/search',
        maxMs: 90,
      },
      {
        service: NEIGHBOR_SERVICE,
        spanName: 'inventory.lookup',
        total: TOTAL_NEIGHBOR_TRACES,
        route: '/api/inventory/{sku}',
        maxMs: 60,
      },
    ];
    for (const floor of neighborFloors) {
      const total = Math.max(25, Math.round(floor.total * factor));
      for (let i = 0; i < total; i++) {
        const t = spreadTimestamp(i, total, windowStart, HISTORY_WINDOW_MS);
        const isError = rng.next() < 0.002;
        traces.push(
          makeSpan({
            rng,
            timestampMs: t,
            traceId: newTraceId(rng),
            spanId: newSpanId(rng),
            spanName: floor.spanName,
            spanKind: 'SPAN_KIND_SERVER',
            serviceName: floor.service,
            durationNs: msToNs(
              isError ? rng.range(200, 900) : rng.range(2, floor.maxMs),
            ),
            statusCode: isError ? 'STATUS_CODE_ERROR' : 'STATUS_CODE_OK',
            statusMessage: isError ? 'internal error' : '',
            resourceAttributes: pickResource(rng, resourcePool, floor.service),
            spanAttributes: {
              'http.route': floor.route,
              'http.request.method': 'GET',
              'http.response.status_code': isError ? '500' : '200',
            },
          }),
        );
        if (traces.length >= batchSize) {
          yield { traces: traces.splice(0, traces.length), logs: [] };
        }
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
      } else if (kind === 'search_ops') {
        service = JVM_TWIN_SERVICE;
        const tmpl = serviceOpsDebugLog({
          rng,
          nowMs: t,
          serviceName: JVM_TWIN_SERVICE,
        });
        body = tmpl.body;
        attrs = tmpl.attrs;
        sevText = tmpl.level;
      } else if (kind === 'inventory_ops') {
        service = NEIGHBOR_SERVICE;
        const tmpl = serviceOpsDebugLog({
          rng,
          nowMs: t,
          serviceName: NEIGHBOR_SERVICE,
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

    // ── Planted proxy 503s naming the failing upstream (fixed volume) ────
    // Pressure-correlated: the blinded prompt's "upstream 503s at
    // frontend-proxy" are findable, and they point at recommendation-service
    // without revealing the memory/GC cause.
    const scrapeCount = Math.floor(HISTORY_WINDOW_MS / SCRAPE_INTERVAL_MS);
    for (let i = 0; i < scrapeCount; i++) {
      const t = windowStart + i * SCRAPE_INTERVAL_MS;
      const pressure = heapPressure(nowMs, t);
      if (pressure < 0.05 || rng.next() >= pressure) continue;
      const n = rng.intRange(1, 3);
      for (let k = 0; k < n; k++) {
        logs.push(
          proxyUpstream503Log(rng, t + rng.intRange(0, SCRAPE_INTERVAL_MS)),
        );
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
