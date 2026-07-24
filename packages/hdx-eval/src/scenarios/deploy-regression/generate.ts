/**
 * deploy-regression scenario
 *
 * Story: checkout-api starts a rolling deploy of 2.0.0-rc1 ~45 min before
 * `now`. Three of six pods update (one every ~2 min), then the rollout is
 * paused for canary observation. The new build has a code defect: the
 * rewritten promotion handler assumes every promo code has a `percentOff`
 * field, so fixed-amount codes (FREESHIP, FLAT5, GIFT10) throw
 * `TypeError: Cannot read properties of undefined (reading 'percentOff')`
 * and the request 500s. Result: ~7-8% of checkouts fail, but ONLY on pods
 * running 2.0.0-rc1 and ONLY for fixed-amount promo codes.
 *
 * Unlike metric-saturation, the full causal chain lives in TRACES + LOGS —
 * but none of it is pre-labeled:
 *   - checkout-api telemetry carries NO `service.version` resource
 *     attribute (realistic: the fleet doesn't stamp build versions into
 *     OTel resources). The smoking-gun cross-tab is a two-step join:
 *     group POST /api/checkout errors by `k8s.pod.name` → exactly 3 of 6
 *     pods are bad → the deployment.rollout event logs name exactly those
 *     pods flipping to 2.0.0-rc1.
 *   - Defect spans carry `checkout.promo_code` but no promo-type label,
 *     and their statusMessage is a generic 'internal error' (same as
 *     baseline noise). The failure is separable only via the pod × promo
 *     cross-tab and the fail-fast duration.
 *   - Only ~1-in-7 defect hits log the full TypeError stack trace
 *     (error-sampling); the rest emit a generic trace-correlated
 *     'checkout.request_failed' ERROR that names neither TypeError nor
 *     promotions.
 *
 * Metrics exist but are CORROBORATING ONLY. They are keyed by service, not
 * version or pod, so they cannot reveal the pod split or the defect:
 *   - Histogram http.server.request.duration{200|500} : 500-count steps up.
 *   - Sum       http.server.request.count{2xx|5xx}    : 5xx slope changes.
 *   - Gauge     system.cpu.utilization / process.memory.usage : flat,
 *     healthy — rules out infra saturation.
 *   - Gauge     inventory.sync.queue.depth (inventory-service) : noisy but
 *     benign across the whole window — a metric red herring.
 *
 * The scenario measures ORGANIC metric-tool adoption via the transcript
 * rubric: the agent doesn't need the metric tools, so reaching for them is
 * the adoption signal (contrast with metric-saturation, where it's forced).
 *
 * Distractors: an INNOCENT completed payment-service rollout minutes before
 * checkout's (the "blame the other deploy" trap), a deploy-introduced
 * benign DeprecationWarning flood from the new-build pods that steps at the
 * SAME boundary as the errors (the "new pattern at the boundary = cause"
 * trap), healthy payment-service child spans, constant-rate
 * NonFatalRetryableError caught-exception noise on checkout-api, a brief
 * self-resolving recommendation-service 502 burst that PREDATES the deploy,
 * and the noisy queue-depth gauge.
 *
 * CONSISTENCY (second hardening round): difficulty lives in the ANSWER
 * rubric, not in budget cliffs or accidental confounders —
 *   - checkout-api and payment-service each run on a dedicated, disjoint
 *     node pool (one pod per node). The old shared 4-node pool made
 *     payment's rollout look like it landed "on the same hosts" as the
 *     checkout errors — an undesigned noisy-neighbor rabbit hole that
 *     burned wall clock without discriminating anything.
 *   - maxTurns 32 (the raw-SQL arm burns one turn per query and used to
 *     hit 25 turns with half its wall clock unused).
 *   - The system prompt appends a scenario-local budget-discipline note
 *     (hard wall-clock limit exists; reserve the final turn for the
 *     answer) so runs stop dying mid-hypothesis with nothing written.
 *
 * CONSISTENCY (third round): the 300s wall clock, not the turn budget,
 * turned out to be the binding constraint — half the runs in batch
 * 2026-07-24T08-41-58 timed out mid-investigation (completed runs needed
 * 185-273s) and were graded on interim notes, which the judge scored
 * anywhere from 0.02 to 0.98 depending on how much diagnosis it
 * hallucinated from the ground-truth facts. Three changes:
 *   - maxTurns 32 -> 26 so the budget the agent CAN observe (its own
 *     tool-call count) binds before the wall clock it cannot.
 *   - The prompt's TURN BUDGET line shows a SOFT answer checkpoint
 *     (cap - 8) instead of the hard cap (which read as "exhaust the
 *     whole budget, then answer"), and BUDGET_NOTE is phrased in
 *     countable tool calls, not unobservable minutes.
 *   - A scenario-local judge preamble forbids crediting claims the
 *     answer does not state — truncated interim notes score 0 instead
 *     of a coin flip.
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

const SUBJECT_SERVICE = 'checkout-api';
const PAYMENT_SERVICE = 'payment-service';
const NEIGHBOR_SERVICE = 'inventory-service';
const RECO_SERVICE = 'recommendation-service';
const PROXY_SERVICE = 'frontend-proxy';

// ─── Time model ─────────────────────────────────────────────────────────────
// 2-hour window. The rolling deploy starts 45 min before `now`; canary pods
// flip one at a time every 2 min (pods 0..2), then the rollout pauses at 3/6
// for canary observation. An INNOCENT payment-service rollout completes
// shortly before (starts 58 min ago, 6/6 pods by 52 min ago) — close enough
// to the onset that "a deploy happened around then" cannot attribute blame.
// The recommendation-service 502 burst (distractor) happens 70 min before
// `now` — clearly BEFORE both deploys and self-resolved.

const HISTORY_WINDOW_MS = 2 * 60 * 60 * 1000;
const SCRAPE_INTERVAL_MS = 120 * 1000;
const DEPLOY_AGO_MS = 45 * 60 * 1000;
const ROLLOUT_STAGGER_MS = 2 * 60 * 1000;
const BURST_AGO_MS = 70 * 60 * 1000;
const BURST_DURATION_MS = 5 * 60 * 1000;

const POD_COUNT = 6;
const CANARY_POD_COUNT = 3;

const OLD_VERSION = '1.43.1';
const NEW_VERSION = '2.0.0-rc1';

// Innocent payment-service rollout (distractor): starts 58 min ago, one pod
// per minute (6 pods), completion event 52 min ago — 7 min before checkout's
// first pod flip, where the errors actually start.
const PAYMENT_DEPLOY_AGO_MS = 58 * 60 * 1000;
const PAYMENT_ROLLOUT_STAGGER_MS = 60 * 1000;
const PAYMENT_COMPLETE_AGO_MS = 52 * 60 * 1000;
const PAYMENT_POD_COUNT = 6;
const PAYMENT_OLD_VERSION = '3.6.2';
const PAYMENT_NEW_VERSION = '3.7.0';

// ─── Failure model ──────────────────────────────────────────────────────────
// ~30% of checkouts apply a promo code; half of the promo picks are
// fixed-amount (the kind that lacks `percentOff`), and those ALWAYS fail on
// 2.0.0-rc1. With 3/6 pods updated: 0.5 * 0.3 * 0.5 ≈ 7.5% overall checkout
// error rate.

const PROMO_FRACTION = 0.3;
const FIXED_PROMO_SHARE = 0.5; // share of promo picks that are fixed-amount
// Uneven-share catalogs: the failing set isn't a trivial "2 of 4".
const PERCENT_PROMO_MIX = [
  { value: 'SAVE10', weight: 40 },
  { value: 'VIP20', weight: 25 },
  { value: 'WELCOME15', weight: 20 },
  { value: 'SPRING25', weight: 15 },
] as const;
const FIXED_PROMO_MIX = [
  { value: 'FREESHIP', weight: 45 },
  { value: 'FLAT5', weight: 40 },
  { value: 'GIFT10', weight: 15 },
] as const;
const BASELINE_ERROR_RATE = 0.003;

// Defect spans carry the same generic status message as baseline noise —
// the pod × promo cross-tab (not a label) separates them.
const GENERIC_STATUS_MESSAGE = 'internal error';
const DEFECT_STACK = [
  "TypeError: Cannot read properties of undefined (reading 'percentOff')",
  '    at applyPromotion (/app/handlers/promotion.js:87:31)',
  '    at processCheckout (/app/handlers/checkout.js:214:19)',
  '    at async CheckoutController.create (/app/controllers/checkout.js:52:9)',
  '    at async /app/middleware/route.js:31:7',
].join('\n');
// Error-sampling: only every Nth defect hit logs the full stack trace
// (deterministic modulo — the count is exact at every volumeFactor). The
// rest emit this generic trace-correlated failure line.
const STACK_SAMPLE_EVERY = 7;
const GENERIC_FAILURE_BODY =
  'Unhandled error processing POST /api/checkout (500); request aborted';

// Deploy-introduced benign WARN flood: new-build pods emit this from their
// flip time at a rate ~10x the sampled stack traces. It steps at the SAME
// boundary as the real errors but is topically unrelated and benign.
const DEPRECATION_BODY =
  'DeprecationWarning: legacy session-cookie format detected; ' +
  'session-store v1 support is removed in 3.0. ' +
  'Set checkout.session.store=v2 to silence this warning.';
const DEPRECATION_FLOOD_TOTAL = 6_000;

// ─── Metric constants ───────────────────────────────────────────────────────

const LATENCY_BOUNDS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const CHECKOUT_REQS_PER_SCRAPE = 200;

// ─── Volumes ────────────────────────────────────────────────────────────────
// Trace/log floor is the load-bearing signal here, so it's richer than
// metric-saturation's — but still modest enough to seed quickly. Planted
// anomaly volumes (burst spans, rollout logs) stay fixed.

const TOTAL_TRACES = 400_000;
const TOTAL_LOGS = 800_000;
const BURST_SPAN_COUNT = 150;
const BURST_LOG_COUNT = 30;

// Traffic mix across the trace floor (weights are relative).
const TRAFFIC_MIX = [
  { value: 'checkout', weight: 37 },
  { value: 'cart', weight: 31 },
  { value: 'order', weight: 24 },
  { value: 'reco', weight: 8 },
] as const;

// Log-floor mix. checkout-api chatter + proxy access/probe + neighbor ops +
// the constant-rate caught-exception decoy (an "error-looking" pattern whose
// rate does NOT change at the deploy — real errors do).
const LOG_MIX = [
  { value: 'cache_hit', weight: 30 },
  { value: 'envoy', weight: 25 },
  { value: 'health_probe', weight: 10 },
  { value: 'inventory_ops', weight: 15 },
  { value: 'reco_ops', weight: 10 },
  { value: 'caught_exception', weight: 10 },
] as const;

type Rng = GenerateContext['rng'];

// ─── Rollout model ──────────────────────────────────────────────────────────

/** Time pod `pod` flips to NEW_VERSION (Infinity = never — rollout paused). */
function podFlipMs(nowMs: number, pod: number): number {
  if (pod >= CANARY_POD_COUNT) return Number.POSITIVE_INFINITY;
  return nowMs - DEPLOY_AGO_MS + pod * ROLLOUT_STAGGER_MS;
}

function versionForPod(nowMs: number, pod: number, t: number): string {
  return t >= podFlipMs(nowMs, pod) ? NEW_VERSION : OLD_VERSION;
}

/** Time payment pod `pod` flips (innocent rollout — all 6 complete). */
function paymentPodFlipMs(nowMs: number, pod: number): number {
  return nowMs - PAYMENT_DEPLOY_AGO_MS + pod * PAYMENT_ROLLOUT_STAGGER_MS;
}

function paymentVersionForPod(nowMs: number, pod: number, t: number): string {
  return t >= paymentPodFlipMs(nowMs, pod)
    ? PAYMENT_NEW_VERSION
    : PAYMENT_OLD_VERSION;
}

/** Fraction of pods on NEW_VERSION at `t`. */
function updatedPodFraction(nowMs: number, t: number): number {
  let updated = 0;
  for (let pod = 0; pod < POD_COUNT; pod++) {
    if (t >= podFlipMs(nowMs, pod)) updated++;
  }
  return updated / POD_COUNT;
}

/** Expected fraction of checkout requests failing at `t` (aggregate view). */
function checkoutFailureFraction(nowMs: number, t: number): number {
  return updatedPodFraction(nowMs, t) * PROMO_FRACTION * FIXED_PROMO_SHARE;
}

// ─── Metric generation (corroborating only — keyed by service, NOT version) ─

function generateMetrics(rng: Rng, nowMs: number): MetricBatch {
  const windowStart = nowMs - HISTORY_WINDOW_MS;
  const scrapeCount = Math.floor(HISTORY_WINDOW_MS / SCRAPE_INTERVAL_MS);

  const gauge: GaugeMetricRow[] = [];
  const sum: SumMetricRow[] = [];
  const histogram: HistogramMetricRow[] = [];

  // Deliberately NO service.version / pod split in metric resource
  // attributes: the aggregate error-rate step is visible, but the pod
  // cross-tab (the actual diagnosis) is not reconstructable from metrics.
  const subjectResource: Record<string, string> = {
    'service.name': SUBJECT_SERVICE,
    'service.namespace': 'production',
    'k8s.namespace.name': 'production',
    'k8s.deployment.name': SUBJECT_SERVICE,
  };
  const neighborResource: Record<string, string> = {
    'service.name': NEIGHBOR_SERVICE,
    'service.namespace': 'production',
    'k8s.namespace.name': 'production',
    'k8s.deployment.name': NEIGHBOR_SERVICE,
  };

  let cum2xx = 0;
  let cum5xx = 0;

  for (let i = 0; i < scrapeCount; i++) {
    const t = windowStart + i * SCRAPE_INTERVAL_MS;
    const failFrac = checkoutFailureFraction(nowMs, t);

    // ── Gauges: flat, healthy infra (rules out saturation) ───────────────
    gauge.push(
      makeGauge({
        timeUnixMs: t,
        serviceName: SUBJECT_SERVICE,
        metricName: 'system.cpu.utilization',
        metricUnit: '1',
        metricDescription: 'CPU utilization (0-1)',
        value: Number(rng.range(0.22, 0.34).toFixed(3)),
        resourceAttributes: subjectResource,
        attributes: { state: 'used' },
      }),
    );
    gauge.push(
      makeGauge({
        timeUnixMs: t,
        serviceName: SUBJECT_SERVICE,
        metricName: 'process.memory.usage',
        metricUnit: 'By',
        metricDescription: 'Process resident memory',
        value: Math.round(rng.range(470, 540) * 1024 * 1024),
        resourceAttributes: subjectResource,
        attributes: {},
      }),
    );

    // ── Gauge red herring: noisy-but-benign neighbor queue depth ─────────
    // Wobbles (with occasional spikes) across the WHOLE window — visually
    // alarming, uncorrelated with the incident.
    const spiky = rng.next() < 0.06;
    gauge.push(
      makeGauge({
        timeUnixMs: t,
        serviceName: NEIGHBOR_SERVICE,
        metricName: 'inventory.sync.queue.depth',
        metricUnit: '{jobs}',
        metricDescription: 'Pending jobs in the inventory sync queue',
        value: spiky ? rng.intRange(150, 400) : rng.intRange(0, 90),
        resourceAttributes: neighborResource,
        attributes: { queue: 'inventory-sync' },
      }),
    );

    // ── Requests this scrape: OK vs failed checkout calls ────────────────
    const reqs = CHECKOUT_REQS_PER_SCRAPE;
    const baselineFail = rng.next() < reqs * BASELINE_ERROR_RATE ? 1 : 0;
    const fails = Math.max(baselineFail, Math.round(reqs * failFrac));
    const oks = reqs - fails;

    // ── Histogram: request-duration by status (delta temporality) ────────
    const okSamples: number[] = [];
    for (let s = 0; s < oks; s++) okSamples.push(rng.range(30, 280));
    histogram.push(
      makeHistogram({
        timeUnixMs: t,
        serviceName: SUBJECT_SERVICE,
        metricName: 'http.server.request.duration',
        metricUnit: 'ms',
        metricDescription: 'HTTP server request duration',
        aggregationTemporality: 1,
        ...bucketize(okSamples, LATENCY_BOUNDS_MS),
        explicitBounds: [...LATENCY_BOUNDS_MS],
        resourceAttributes: subjectResource,
        attributes: {
          'http.route': '/api/checkout',
          'http.response.status_code': '200',
        },
      }),
    );
    if (fails > 0) {
      // Defect requests fail FAST (TypeError thrown before any I/O).
      const errSamples: number[] = [];
      for (let s = 0; s < fails; s++) errSamples.push(rng.range(6, 40));
      histogram.push(
        makeHistogram({
          timeUnixMs: t,
          serviceName: SUBJECT_SERVICE,
          metricName: 'http.server.request.duration',
          metricUnit: 'ms',
          metricDescription: 'HTTP server request duration',
          aggregationTemporality: 1,
          ...bucketize(errSamples, LATENCY_BOUNDS_MS),
          explicitBounds: [...LATENCY_BOUNDS_MS],
          resourceAttributes: subjectResource,
          attributes: {
            'http.route': '/api/checkout',
            'http.response.status_code': '500',
          },
        }),
      );
    }

    // ── Sums: cumulative request counters by status class ────────────────
    cum2xx += oks;
    cum5xx += fails;
    sum.push(
      makeSum({
        timeUnixMs: t,
        serviceName: SUBJECT_SERVICE,
        metricName: 'http.server.request.count',
        metricDescription: 'Cumulative HTTP requests served',
        value: cum2xx,
        resourceAttributes: subjectResource,
        attributes: { 'http.route': '/api/checkout', status_class: '2xx' },
      }),
    );
    sum.push(
      makeSum({
        timeUnixMs: t,
        serviceName: SUBJECT_SERVICE,
        metricName: 'http.server.request.count',
        metricDescription: 'Cumulative HTTP requests served',
        value: cum5xx,
        resourceAttributes: subjectResource,
        attributes: { 'http.route': '/api/checkout', status_class: '5xx' },
      }),
    );
  }

  return { gauge, sum, histogram };
}

// ─── Scenario ───────────────────────────────────────────────────────────────

// Turn budget: the agent can COUNT its tool calls but cannot observe
// wall-clock time, so the hard cap must be low enough to bind BEFORE the
// wall-clock limit (~9-11s per tool call ⇒ 26 turns fits inside the 300s
// default --timeout).
const DEPLOY_MAX_TURNS = 26;
// Soft answer checkpoint shown in the prompt's TURN BUDGET line — showing
// the HARD cap there would instruct the agent to exhaust the entire
// budget before answering.
const SOFT_ANSWER_TURN_MARGIN = 8;

// Scenario-local budget-discipline note, appended after the shared
// investigation prompt. Phrased in tool-call counts, not minutes — the
// agent cannot observe elapsed wall time. The metrics signalsNote stays
// byte-identical to metric-saturation's (adoption parity).
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

// Judge preamble (third consistency round). Scenario-local override:
// identical to the default "evaluating an SRE investigation" preamble in
// grading/judgePrompt.ts plus the SCORE ONLY WHAT IS WRITTEN block.
// Without it, judging truncated runs is a coin flip: two near-identical
// mid-investigation notes ("let me verify one last detail") in the same
// batch scored 0.98 and 0.02 — the 0.98 judge hallucinated the diagnosis
// from the ground-truth facts and credited claims the candidate never
// wrote.
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

export const deployRegressionScenario: Scenario = {
  name: 'deploy-regression',
  agentPrompt: groundTruth.agentPrompt,
  // See DEPLOY_MAX_TURNS above: high enough for the mandatory steps
  // (blinded entry, pod cross-tab + rollout-event join, promo-code
  // inference, two co-timed deploys), low enough that the observable
  // turn budget binds before the unobservable 300s wall clock.
  maxTurns: DEPLOY_MAX_TURNS,
  description:
    'checkout-api staged rollout regression: 2.0.0-rc1 canary (3/6 pods) throws a TypeError in applyPromotion on fixed-amount promo codes -> ~7% checkout 500s. No service.version stamping — the smoking gun is a k8s.pod.name cross-tab joined against rollout event logs; the TypeError stack is error-sampled (~1-in-7) and the trigger has no promo-type label. Metrics (latency histogram, 5xx sum, flat CPU/memory gauges) only corroborate — measures organic metric-tool adoption. Distractors: innocent completed payment-service rollout minutes earlier, deploy-introduced DeprecationWarning flood stepping at the same boundary, healthy payment spans, constant NonFatalRetryableError noise, pre-deploy recommendation-service 502 burst, noisy-but-benign queue-depth gauge. Consistency rounds: dedicated disjoint node pools per service (no accidental host-overlap confounder); 26-turn hard cap with a soft answer checkpoint (~18) shown in the prompt so the observable turn budget binds before the invisible 300s wall clock; a count-your-tool-calls budget note; and a truncation-strict judge preamble (interim notes score 0 — no ground-truth fill-in). Difficulty lives in the excellence-tier rubric.',
  buildSystemPrompt: ctx => {
    // Show a SOFT checkpoint in the TURN BUDGET line, not the hard cap —
    // the harness still enforces ctx.maxTurns. Tracks a CLI --max-turns
    // override so the checkpoint stays proportional.
    const softAnswerTurn = Math.max(
      10,
      (ctx.maxTurns ?? DEPLOY_MAX_TURNS) - SOFT_ANSWER_TURN_MARGIN,
    );
    return (
      buildInvestigationSystemPrompt(
        'deploy-regression',
        ctx.anchorTimeIso,
        ctx.variant,
        softAnswerTurn,
        {
          // Byte-identical to metric-saturation's note: discoverability is
          // held constant between the two scenarios, so the adoption delta
          // measures inclination, not awareness.
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

    // Metrics first (fixed volume — corroboration never scales).
    const metrics = generateMetrics(rng, nowMs);
    yield { traces: [], logs: [], metrics };

    // checkout-api gets a fixed 6-pod pool. The fleet does NOT
    // stamp service.version into OTel resources — the pod identity
    // (k8s.pod.name) is the only per-pod dimension; the rollout event logs
    // are what tie pods to versions. The pods are pinned to one namespace/
    // region (a single deployment — no accidental coarse proxy split via
    // namespace or region group-bys). The defect stack is Node, so pin the
    // SDK language.
    const pinDeployment = (r: Record<string, string>) => ({
      ...r,
      'service.namespace': 'production',
      'k8s.namespace.name': 'production',
      'deployment.environment.name': 'production',
      'cloud.region': 'us-east-1',
    });
    // Each controlled pool gets a DEDICATED node pool, one pod per node.
    // The generic buildResourcePool assigns nodes from a shared 4-name
    // list, which made payment's rollout look like it landed "on the same
    // hosts" as the checkout errors — an accidental cross-service
    // confounder (and wall-clock sink) we never designed. Disjoint,
    // service-prefixed node names remove the correlation; a node-level
    // group-by now just mirrors the pod split instead of inventing a
    // noisy-neighbor story.
    const pinNode = (
      attrs: Record<string, string>,
      poolName: string,
    ): Record<string, string> => {
      const node = `gke-prod-${poolName}-${rng.hex(8)}-${rng.hex(4)}`;
      return { ...attrs, 'k8s.node.name': node, 'host.name': node };
    };
    const checkoutPods = buildResourcePool({
      rng,
      services: [SUBJECT_SERVICE],
      instancesPerService: POD_COUNT,
    })[SUBJECT_SERVICE].map(r => {
      const attrs = pinNode(
        pinDeployment({ ...r, 'telemetry.sdk.language': 'nodejs' }),
        'checkout',
      );
      delete attrs['service.version'];
      return attrs;
    });
    const checkoutPodResource = (pod: number): Record<string, string> =>
      checkoutPods[pod];

    // payment-service gets a controlled 6-pod pool whose service.version
    // flips per its own (innocent, completed) rollout — it DOES stamp
    // versions, so its new build is provably healthy.
    const paymentPods = buildResourcePool({
      rng,
      services: [PAYMENT_SERVICE],
      instancesPerService: PAYMENT_POD_COUNT,
    })[PAYMENT_SERVICE].map(r => pinNode(pinDeployment(r), 'payment'));
    const paymentPodResource = (
      pod: number,
      t: number,
    ): Record<string, string> => ({
      ...paymentPods[pod],
      'service.version': paymentVersionForPod(nowMs, pod, t),
    });

    const resourcePool = buildResourcePool({
      rng,
      services: [PROXY_SERVICE, NEIGHBOR_SERVICE, RECO_SERVICE],
      instancesPerService: 12,
    });

    // ── Trace floor + planted defect ──────────────────────────────────────
    const totalTraces = Math.max(50, Math.round(TOTAL_TRACES * factor));
    const traces: TraceRow[] = [];
    const plantedLogs: LogRow[] = [];
    let defectCount = 0;

    for (let i = 0; i < totalTraces; i++) {
      const t = spreadTimestamp(i, totalTraces, windowStart, HISTORY_WINDOW_MS);
      const kind = rng.weightedPick(TRAFFIC_MIX);

      if (kind === 'reco') {
        traces.push(
          makeSpan({
            rng,
            timestampMs: t,
            traceId: newTraceId(rng),
            spanId: newSpanId(rng),
            spanName: 'recommendation.score',
            spanKind: 'SPAN_KIND_SERVER',
            serviceName: RECO_SERVICE,
            durationNs: msToNs(rng.range(8, 120)),
            resourceAttributes: pickResource(rng, resourcePool, RECO_SERVICE),
            spanAttributes: {
              'http.route': '/api/recommendations',
              'http.request.method': 'GET',
              'http.response.status_code': '200',
            },
          }),
        );
      } else {
        const pod = rng.intRange(0, POD_COUNT);
        const version = versionForPod(nowMs, pod, t);
        const resourceAttributes = checkoutPodResource(pod);

        const isCheckout = kind === 'checkout';
        const route = isCheckout
          ? '/api/checkout'
          : kind === 'cart'
            ? '/api/cart'
            : '/api/order';
        const method = isCheckout ? 'POST' : 'GET';
        const spanName = `${method} ${route}`;

        // Promo attribution (checkout only) and the planted defect. The
        // span carries only the promo CODE — no type label; the fixed-vs-
        // percent distinction must be inferred from the failing set + the
        // percentOff stack trace.
        let promoCode: string | undefined;
        let promoIsFixed = false;
        if (isCheckout && rng.next() < PROMO_FRACTION) {
          if (rng.next() < FIXED_PROMO_SHARE) {
            promoCode = rng.weightedPick(FIXED_PROMO_MIX);
            promoIsFixed = true;
          } else {
            promoCode = rng.weightedPick(PERCENT_PROMO_MIX);
          }
        }
        const defectHit = isCheckout && version === NEW_VERSION && promoIsFixed;
        const baselineErr = !defectHit && rng.next() < BASELINE_ERROR_RATE;

        const durationMs = defectHit
          ? rng.range(6, 40) // TypeError thrown before any I/O — fails fast
          : baselineErr
            ? rng.range(200, 1500)
            : isCheckout
              ? rng.range(30, 280)
              : rng.range(8, 120);

        const traceId = newTraceId(rng);
        const spanId = newSpanId(rng);
        traces.push(
          makeSpan({
            rng,
            timestampMs: t,
            traceId,
            spanId,
            spanName,
            spanKind: 'SPAN_KIND_SERVER',
            serviceName: SUBJECT_SERVICE,
            durationNs: msToNs(durationMs),
            statusCode:
              defectHit || baselineErr ? 'STATUS_CODE_ERROR' : 'STATUS_CODE_OK',
            statusMessage:
              defectHit || baselineErr ? GENERIC_STATUS_MESSAGE : '',
            resourceAttributes,
            spanAttributes: {
              'http.route': route,
              'http.request.method': method,
              'http.response.status_code':
                defectHit || baselineErr ? '500' : '200',
              ...(isCheckout
                ? {
                    'checkout.cart_items': String(rng.intRange(1, 12)),
                    'checkout.total_cents': String(rng.intRange(499, 89999)),
                  }
                : {}),
              ...(promoCode ? { 'checkout.promo_code': promoCode } : {}),
            },
          }),
        );

        // Trace-correlated defect logs. Error-sampled: every Nth defect hit
        // logs the full stack trace that NAMES the bug; the rest log a
        // generic failure line (no TypeError, no promotion).
        if (defectHit) {
          defectCount++;
          const sampled = defectCount % STACK_SAMPLE_EVERY === 1;
          plantedLogs.push(
            makeLog({
              timestampMs: t + rng.intRange(1, 30),
              traceId,
              spanId,
              serviceName: SUBJECT_SERVICE,
              severityText: 'ERROR',
              body: sampled ? DEFECT_STACK : GENERIC_FAILURE_BODY,
              resourceAttributes,
              logAttributes: sampled
                ? {
                    'event.name': 'checkout.unhandled_exception',
                    'error.kind': 'TypeError',
                    'code.function.name': 'applyPromotion',
                    'checkout.promo_code': promoCode!,
                    'http.route': '/api/checkout',
                    'log.iostream': 'stderr',
                    logtag: 'F',
                  }
                : {
                    'event.name': 'checkout.request_failed',
                    'http.route': '/api/checkout',
                    'http.response.status_code': '500',
                    'log.iostream': 'stderr',
                    logtag: 'F',
                  },
            }),
          );
        }

        // Healthy payment-service child span for successful checkouts —
        // the "blame the dependency" decoy stays visibly healthy (on BOTH
        // sides of its own innocent rollout). Failed checkouts never reach
        // payment (promotion is applied first).
        if (isCheckout && !defectHit && !baselineErr && rng.next() < 0.85) {
          const paymentPod = rng.intRange(0, PAYMENT_POD_COUNT);
          traces.push(
            makeSpan({
              rng,
              timestampMs: t + rng.intRange(2, 20),
              traceId,
              spanId: newSpanId(rng),
              parentSpanId: spanId,
              spanName: 'payment.authorize',
              spanKind: 'SPAN_KIND_SERVER',
              serviceName: PAYMENT_SERVICE,
              durationNs: msToNs(rng.range(20, 120)),
              resourceAttributes: paymentPodResource(paymentPod, t),
              spanAttributes: {
                'payment.provider': rng.pick(['stripe', 'adyen', 'braintree']),
                'payment.method': rng.pick(['card', 'wallet', 'bank']),
                'http.response.status_code': '200',
              },
            }),
          );
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

    // ── Distractor: pre-deploy recommendation-service 502 burst ──────────
    // Fixed volume (planted anomaly). Starts 70 min ago, self-resolves in
    // ~5 min — disjoint from both deploys in time and service.
    const burstStart = nowMs - BURST_AGO_MS;
    for (let i = 0; i < BURST_SPAN_COUNT; i++) {
      const t =
        burstStart +
        Math.floor((i / BURST_SPAN_COUNT) * (BURST_DURATION_MS - 2000)) +
        rng.intRange(0, 1500);
      traces.push(
        makeSpan({
          rng,
          timestampMs: t,
          traceId: newTraceId(rng),
          spanId: newSpanId(rng),
          spanName: 'recommendation.score',
          spanKind: 'SPAN_KIND_SERVER',
          serviceName: RECO_SERVICE,
          durationNs: msToNs(rng.range(1, 12)),
          statusCode: 'STATUS_CODE_ERROR',
          statusMessage:
            'upstream connect error or disconnect/reset before headers (connection termination)',
          resourceAttributes: pickResource(rng, resourcePool, RECO_SERVICE),
          spanAttributes: {
            'http.route': '/api/recommendations',
            'http.request.method': 'GET',
            'http.response.status_code': '502',
          },
        }),
      );
    }
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
        const pod = rng.intRange(0, POD_COUNT);
        resourceAttributes = checkoutPodResource(pod);
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
        service = kind === 'inventory_ops' ? NEIGHBOR_SERVICE : RECO_SERVICE;
        resourceAttributes = pickResource(rng, resourcePool, service);
        const tmpl = serviceOpsDebugLog({
          rng,
          nowMs: t,
          serviceName: service as
            | 'inventory-service'
            | 'recommendation-service',
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

    // ── Distractor: deploy-introduced benign DeprecationWarning flood ────
    // Emitted ONLY by new-build pods, each from its own flip time — the
    // total rate steps up at the exact same boundaries as the real errors,
    // but the pattern is WARN, has no trace correlation, and is topically
    // unrelated. Scales with volumeFactor at a fixed ~10x multiple of the
    // sampled stack-trace count, so it outranks the confession in any
    // pattern ranking.
    const floodCount = Math.max(
      30,
      Math.round(DEPRECATION_FLOOD_TOTAL * factor),
    );
    for (let i = 0; i < floodCount; i++) {
      const pod = i % CANARY_POD_COUNT;
      const flip = podFlipMs(nowMs, pod);
      const t = flip + Math.floor(rng.range(0, nowMs - flip));
      logs.push(
        makeLog({
          timestampMs: t,
          serviceName: SUBJECT_SERVICE,
          severityText: 'WARN',
          body: DEPRECATION_BODY,
          resourceAttributes: checkoutPodResource(pod),
          logAttributes: {
            'event.name': 'runtime.deprecation',
            'code.function.name': 'loadSessionCookie',
            'log.iostream': 'stderr',
            logtag: 'F',
          },
        }),
      );
      if (logs.length >= batchSize) {
        yield { traces: [], logs: logs.splice(0, logs.length) };
      }
    }

    // ── Planted rollout events (fixed volume) ─────────────────────────────
    // Innocent payment-service rollout: starts BEFORE checkout's, completes
    // 6/6, and its service is provably healthy on both versions.
    const paymentDeployMs = nowMs - PAYMENT_DEPLOY_AGO_MS;
    plantedLogs.push(
      makeLog({
        timestampMs: paymentDeployMs,
        serviceName: PAYMENT_SERVICE,
        severityText: 'INFO',
        body: `Deployment payment-service rolling update started: version ${PAYMENT_OLD_VERSION} -> ${PAYMENT_NEW_VERSION} (target ${PAYMENT_POD_COUNT} replicas)`,
        resourceAttributes: {
          'service.name': PAYMENT_SERVICE,
          'k8s.deployment.name': PAYMENT_SERVICE,
        },
        logAttributes: {
          'event.name': 'deployment.rollout',
          'service.version': PAYMENT_NEW_VERSION,
        },
      }),
    );
    for (let pod = 0; pod < PAYMENT_POD_COUNT; pod++) {
      plantedLogs.push(
        makeLog({
          timestampMs: paymentPodFlipMs(nowMs, pod),
          serviceName: PAYMENT_SERVICE,
          severityText: 'INFO',
          body: `Pod ${paymentPods[pod]['k8s.pod.name']} updated to version ${PAYMENT_NEW_VERSION} (${pod + 1}/${PAYMENT_POD_COUNT} pods updated)`,
          resourceAttributes: paymentPodResource(
            pod,
            paymentPodFlipMs(nowMs, pod),
          ),
          logAttributes: {
            'event.name': 'deployment.rollout',
            'service.version': PAYMENT_NEW_VERSION,
            'k8s.pod.name': paymentPods[pod]['k8s.pod.name'],
          },
        }),
      );
    }
    plantedLogs.push(
      makeLog({
        timestampMs: nowMs - PAYMENT_COMPLETE_AGO_MS,
        serviceName: PAYMENT_SERVICE,
        severityText: 'INFO',
        body: `Rollout payment-service completed: ${PAYMENT_POD_COUNT}/${PAYMENT_POD_COUNT} pods updated to version ${PAYMENT_NEW_VERSION}`,
        resourceAttributes: {
          'service.name': PAYMENT_SERVICE,
          'k8s.deployment.name': PAYMENT_SERVICE,
        },
        logAttributes: {
          'event.name': 'deployment.rollout',
          'service.version': PAYMENT_NEW_VERSION,
        },
      }),
    );

    // checkout-api rollout: the guilty one. The event bodies/attributes are
    // the ONLY place pod names and versions are tied together (spans carry
    // no service.version) — this is the intended join.
    const deployMs = nowMs - DEPLOY_AGO_MS;
    plantedLogs.push(
      makeLog({
        timestampMs: deployMs,
        serviceName: SUBJECT_SERVICE,
        severityText: 'INFO',
        body: `Deployment checkout-api rolling update started: version ${OLD_VERSION} -> ${NEW_VERSION} (target ${POD_COUNT} replicas)`,
        resourceAttributes: {
          'service.name': SUBJECT_SERVICE,
          'k8s.deployment.name': SUBJECT_SERVICE,
        },
        logAttributes: {
          'event.name': 'deployment.rollout',
          'service.version': NEW_VERSION,
        },
      }),
    );
    for (let pod = 0; pod < CANARY_POD_COUNT; pod++) {
      plantedLogs.push(
        makeLog({
          timestampMs: podFlipMs(nowMs, pod),
          serviceName: SUBJECT_SERVICE,
          severityText: 'INFO',
          body: `Pod ${checkoutPods[pod]['k8s.pod.name']} updated to version ${NEW_VERSION} (${pod + 1}/${POD_COUNT} pods updated)`,
          resourceAttributes: checkoutPodResource(pod),
          logAttributes: {
            'event.name': 'deployment.rollout',
            'service.version': NEW_VERSION,
            'k8s.pod.name': checkoutPods[pod]['k8s.pod.name'],
          },
        }),
      );
    }
    plantedLogs.push(
      makeLog({
        timestampMs: deployMs + CANARY_POD_COUNT * ROLLOUT_STAGGER_MS,
        serviceName: SUBJECT_SERVICE,
        severityText: 'INFO',
        body: `Rollout checkout-api paused at ${CANARY_POD_COUNT}/${POD_COUNT} pods (canary observation window)`,
        resourceAttributes: {
          'service.name': SUBJECT_SERVICE,
          'k8s.deployment.name': SUBJECT_SERVICE,
        },
        logAttributes: {
          'event.name': 'deployment.rollout',
          'service.version': NEW_VERSION,
        },
      }),
    );

    // ── Distractor: burst-adjacent WARN logs (fixed volume) ───────────────
    for (let i = 0; i < BURST_LOG_COUNT; i++) {
      const t =
        burstStart +
        Math.floor((i / BURST_LOG_COUNT) * (BURST_DURATION_MS - 2000)) +
        rng.intRange(0, 1500);
      logs.push(
        makeLog({
          timestampMs: t,
          serviceName: RECO_SERVICE,
          severityText: 'WARN',
          body: 'upstream connect error or disconnect/reset before headers (connection termination)',
          resourceAttributes: pickResource(rng, resourcePool, RECO_SERVICE),
          logAttributes: {
            'event.name': 'upstream.connect_error',
            'http.response.status_code': '502',
          },
        }),
      );
    }

    if (logs.length || plantedLogs.length) {
      yield { traces: [], logs: [...logs, ...plantedLogs] };
    }
  },
  groundTruth,
};
