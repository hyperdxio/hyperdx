import { loadScenarioRubric } from '@/grading/rubric';
import { buildSystemPrompt } from '@/harness/systemPrompt';
import { mulberry32 } from '@/rng/seeded';
import { deployRegressionScenario } from '@/scenarios/deploy-regression/generate';
import { metricSaturationScenario } from '@/scenarios/metric-saturation/generate';
import { collectScenario } from '@/scenarios/types';

const NOW_MS = Date.parse('2026-05-10T20:00:00.000Z');
// 2% volume keeps the test cheap (~8K spans) while preserving every planted
// signal — metrics and rollout/burst events are fixed-volume, and the defect
// errors scale with the trace floor (still ~80 at this factor).
const TEST_VOLUME_FACTOR = 0.02;

const WINDOW_MS = 2 * 60 * 60 * 1000;
const WINDOW_START_MS = NOW_MS - WINDOW_MS;
const DEPLOY_MS = NOW_MS - 45 * 60 * 1000;
// Canary pods flip at deploy + pod * 2min (pods 0..2).
const LAST_FLIP_MS = DEPLOY_MS + 2 * 2 * 60 * 1000;
// Innocent payment-service rollout: starts 58 min ago, completes 52 min ago.
const PAYMENT_DEPLOY_MS = NOW_MS - 58 * 60 * 1000;
const PAYMENT_COMPLETE_MS = NOW_MS - 52 * 60 * 1000;
const BURST_START_MS = NOW_MS - 70 * 60 * 1000;
const BURST_END_MS = BURST_START_MS + 5 * 60 * 1000;

const NEW_VERSION = '2.0.0-rc1';
const OLD_VERSION = '1.43.1';
const PAYMENT_NEW_VERSION = '3.7.0';
const PAYMENT_OLD_VERSION = '3.6.2';
const FIXED_CODES = new Set(['FREESHIP', 'FLAT5', 'GIFT10']);
// Defect requests fail fast (TypeError before any I/O); baseline errors are
// slow (200-1500ms). 50ms cleanly separates them — there is no label to
// filter by (that's the hardening).
const FAIL_FAST_NS = 50 * 1e6;
const STACK_SAMPLE_EVERY = 7;

function run(seed: number, factor = TEST_VOLUME_FACTOR) {
  return collectScenario(
    deployRegressionScenario.generate({
      rng: mulberry32(seed),
      nowMs: NOW_MS,
      volumeFactor: factor,
    }),
  );
}

describe('deploy-regression scenario', () => {
  const result = run(42);
  const m = result.metrics!;

  const checkoutPosts = result.traces.filter(
    t =>
      t.serviceName === 'checkout-api' && t.spanName === 'POST /api/checkout',
  );
  // No statusMessage / promo-type / version label identifies defect spans
  // anymore — reconstruct them the way the scenario defines them: failed
  // checkouts carrying a fixed-amount promo code that failed fast.
  const defectSpans = checkoutPosts.filter(
    t =>
      t.statusCode === 'STATUS_CODE_ERROR' &&
      FIXED_CODES.has(t.spanAttributes['checkout.promo_code'] ?? '') &&
      t.durationNs < FAIL_FAST_NS,
  );
  const stackLogs = result.logs.filter(
    l => l.logAttributes['event.name'] === 'checkout.unhandled_exception',
  );
  const genericFailLogs = result.logs.filter(
    l => l.logAttributes['event.name'] === 'checkout.request_failed',
  );
  const floodLogs = result.logs.filter(
    l => l.logAttributes['event.name'] === 'runtime.deprecation',
  );
  const rolloutLogs = result.logs.filter(
    l => l.logAttributes['event.name'] === 'deployment.rollout',
  );
  const checkoutRollout = rolloutLogs.filter(
    l => l.serviceName === 'checkout-api',
  );
  const paymentRollout = rolloutLogs.filter(
    l => l.serviceName === 'payment-service',
  );
  // The intended join: rollout flip events name the pods that updated.
  const canaryPodNames = new Set(
    checkoutRollout
      .map(l => l.logAttributes['k8s.pod.name'])
      .filter((p): p is string => Boolean(p)),
  );
  const canaryFlipMsByPod = new Map(
    checkoutRollout
      .filter(l => l.logAttributes['k8s.pod.name'])
      .map(l => [l.logAttributes['k8s.pod.name'], l.timestampMs] as const),
  );

  it('is deterministic for a fixed seed (traces + logs + metrics)', () => {
    const b = run(42);
    expect(b.traces.length).toBe(result.traces.length);
    expect(b.logs.length).toBe(result.logs.length);
    expect(b.traces[10]?.spanId).toBe(result.traces[10]?.spanId);
    expect(JSON.stringify(b.metrics)).toBe(JSON.stringify(m));
  });

  it('anchors every row at or before now, within the window', () => {
    for (const t of result.traces) {
      expect(t.timestampMs).toBeLessThanOrEqual(NOW_MS);
      expect(t.timestampMs).toBeGreaterThanOrEqual(WINDOW_START_MS);
    }
    for (const l of result.logs) {
      expect(l.timestampMs).toBeLessThanOrEqual(NOW_MS);
      expect(l.timestampMs).toBeGreaterThanOrEqual(WINDOW_START_MS);
    }
    const allMetrics = [...m.gauge!, ...m.sum!, ...m.histogram!];
    for (const pt of allMetrics) {
      expect(pt.timeUnixMs).toBeLessThanOrEqual(NOW_MS);
      expect(pt.timeUnixMs).toBeGreaterThanOrEqual(WINDOW_START_MS);
    }
  });

  it('emits gauge/sum/histogram metrics and nothing else', () => {
    expect(m.gauge!.length).toBeGreaterThan(0);
    expect(m.sum!.length).toBeGreaterThan(0);
    expect(m.histogram!.length).toBeGreaterThan(0);
    expect(m.exponentialHistogram!.length).toBe(0);
    expect(m.summary!.length).toBe(0);
  });

  describe('hardening — no pre-labeled answers', () => {
    it('checkout-api telemetry carries NO service.version resource attribute', () => {
      const checkoutTraces = result.traces.filter(
        t => t.serviceName === 'checkout-api',
      );
      expect(checkoutTraces.length).toBeGreaterThan(1000);
      for (const t of checkoutTraces) {
        expect(t.resourceAttributes['service.version']).toBeUndefined();
      }
      for (const l of result.logs) {
        if (l.serviceName !== 'checkout-api') continue;
        expect(l.resourceAttributes['service.version']).toBeUndefined();
      }
    });

    it('pods are pinned to one namespace/region — no coarse proxy for the pod split', () => {
      const pods = [
        ...result.traces
          .filter(
            t =>
              t.serviceName === 'checkout-api' ||
              t.serviceName === 'payment-service',
          )
          .map(t => t.resourceAttributes),
      ];
      for (const r of pods) {
        expect(r['k8s.namespace.name']).toBe('production');
        expect(r['service.namespace']).toBe('production');
        expect(r['cloud.region']).toBe('us-east-1');
      }
    });

    it('checkout and payment run on dedicated, DISJOINT node pools (one pod per node)', () => {
      // The generic resource pool assigns nodes from a shared 4-name list,
      // which used to make payment's rollout look like it landed "on the
      // same hosts" as the checkout errors — an accidental cross-service
      // confounder. Controlled pools now pin one service-prefixed node per
      // pod, so a node group-by mirrors the pod split instead of inventing
      // a noisy-neighbor story.
      const podToNode = (svc: string) => {
        const map = new Map<string, string>();
        for (const t of result.traces) {
          if (t.serviceName !== svc) continue;
          const r = t.resourceAttributes;
          expect(r['host.name']).toBe(r['k8s.node.name']);
          map.set(r['k8s.pod.name'], r['k8s.node.name']);
        }
        return map;
      };
      const checkout = podToNode('checkout-api');
      const payment = podToNode('payment-service');
      // One pod per node: 6 pods ↔ 6 distinct nodes for each service.
      expect(checkout.size).toBe(6);
      expect(new Set(checkout.values()).size).toBe(6);
      expect(payment.size).toBe(6);
      expect(new Set(payment.values()).size).toBe(6);
      // Disjoint from each other AND from every other service's nodes.
      const otherNodes = new Set(
        result.traces
          .filter(
            t =>
              t.serviceName !== 'checkout-api' &&
              t.serviceName !== 'payment-service',
          )
          .map(t => t.resourceAttributes['k8s.node.name']),
      );
      const checkoutNodes = new Set(checkout.values());
      const paymentNodes = new Set(payment.values());
      for (const n of checkoutNodes) {
        expect(paymentNodes.has(n)).toBe(false);
        expect(otherNodes.has(n)).toBe(false);
      }
      for (const n of paymentNodes) expect(otherNodes.has(n)).toBe(false);
      // Log rows for these services stay inside the same node pools
      // (deployment-level rollout events carry no node — skip those).
      for (const l of result.logs) {
        if (
          l.serviceName !== 'checkout-api' &&
          l.serviceName !== 'payment-service'
        )
          continue;
        const node = l.resourceAttributes['k8s.node.name'];
        if (!node) continue;
        const pool =
          l.serviceName === 'checkout-api' ? checkoutNodes : paymentNodes;
        expect(pool.has(node)).toBe(true);
      }
    });

    it('spans carry no promo-type label and no incriminating status message', () => {
      for (const t of checkoutPosts) {
        expect(t.spanAttributes['checkout.promo_type']).toBeUndefined();
        expect(t.statusMessage).not.toMatch(/promo/i);
      }
      // Defect and baseline errors share the same generic status message.
      for (const s of defectSpans) {
        expect(s.statusMessage).toBe('internal error');
      }
    });
  });

  describe('load-bearing property — root cause IS in traces/logs', () => {
    it('defect spans exist, confined to rollout-event pods and fixed-amount codes', () => {
      expect(defectSpans.length).toBeGreaterThan(20);
      expect(canaryPodNames.size).toBe(3);
      for (const s of defectSpans) {
        expect(s.spanAttributes['http.response.status_code']).toBe('500');
        expect(s.timestampMs).toBeGreaterThanOrEqual(DEPLOY_MS);
        // The join: every failing pod is one the rollout events flipped,
        // and the span postdates that pod's flip.
        const pod = s.resourceAttributes['k8s.pod.name'];
        expect(canaryPodNames.has(pod)).toBe(true);
        expect(s.timestampMs).toBeGreaterThanOrEqual(
          canaryFlipMsByPod.get(pod)!,
        );
      }
      // All three canary pods actually fail (not just one).
      const failingPods = new Set(
        defectSpans.map(s => s.resourceAttributes['k8s.pod.name']),
      );
      expect(failingPods).toEqual(canaryPodNames);
    });

    it('percent promo codes never hit the defect, on any pod', () => {
      const percentErrors = checkoutPosts.filter(
        t =>
          t.statusCode === 'STATUS_CODE_ERROR' &&
          t.spanAttributes['checkout.promo_code'] !== undefined &&
          !FIXED_CODES.has(t.spanAttributes['checkout.promo_code']) &&
          t.durationNs < FAIL_FAST_NS,
      );
      expect(percentErrors.length).toBe(0);
    });

    it('stack-trace logs are error-sampled (exact 1-in-7) and trace-correlated', () => {
      // Deterministic modulo sampling: hits 1, 8, 15, ... log the stack.
      expect(stackLogs.length).toBe(
        Math.ceil(defectSpans.length / STACK_SAMPLE_EVERY),
      );
      expect(stackLogs.length).toBeGreaterThan(5);
      const defectTraceIds = new Set(defectSpans.map(s => s.traceId));
      for (const l of stackLogs) {
        expect(l.body).toContain("reading 'percentOff'");
        expect(l.body).toContain('applyPromotion');
        expect(l.timestampMs).toBeGreaterThanOrEqual(DEPLOY_MS);
        expect(defectTraceIds.has(l.traceId!)).toBe(true);
      }
      // The unsampled majority log a generic line that names neither the
      // TypeError nor promotions — the confession is buried, not gone.
      expect(genericFailLogs.length).toBe(
        defectSpans.length - stackLogs.length,
      );
      for (const l of genericFailLogs) {
        expect(l.body).not.toMatch(
          /TypeError|percentOff|applyPromotion|promo/i,
        );
        expect(defectTraceIds.has(l.traceId!)).toBe(true);
      }
    });

    it('the pod cross-tab is the smoking gun: rollout pods fail, the rest stay at baseline', () => {
      const post = checkoutPosts.filter(t => t.timestampMs >= LAST_FLIP_MS);
      const canary = post.filter(t =>
        canaryPodNames.has(t.resourceAttributes['k8s.pod.name']),
      );
      const others = post.filter(
        t => !canaryPodNames.has(t.resourceAttributes['k8s.pod.name']),
      );
      const errRate = (spans: typeof post) =>
        spans.filter(t => t.statusCode === 'STATUS_CODE_ERROR').length /
        spans.length;
      expect(canary.length).toBeGreaterThan(100);
      expect(others.length).toBeGreaterThan(100);
      expect(errRate(canary)).toBeGreaterThan(0.08);
      expect(errRate(others)).toBeLessThan(0.02);
    });

    it('checkout error rate steps up at the deploy', () => {
      const pre = checkoutPosts.filter(t => t.timestampMs < DEPLOY_MS);
      const post = checkoutPosts.filter(t => t.timestampMs >= LAST_FLIP_MS);
      const errRate = (spans: typeof pre) =>
        spans.filter(t => t.statusCode === 'STATUS_CODE_ERROR').length /
        spans.length;
      expect(errRate(pre)).toBeLessThan(0.01);
      expect(errRate(post)).toBeGreaterThan(0.04);
    });

    it('plants the checkout rollout events at the deploy boundary', () => {
      // start event + one per canary pod + pause event.
      expect(checkoutRollout.length).toBe(5);
      const start = checkoutRollout.find(l =>
        /rolling update started: version 1\.43\.1 -> 2\.0\.0-rc1/.test(l.body),
      );
      expect(start).toBeDefined();
      expect(start!.timestampMs).toBe(DEPLOY_MS);
      expect(
        checkoutRollout.some(l => /paused at 3\/6 pods/.test(l.body)),
      ).toBe(true);
      // Versions live in the event payload (the join key), not in the
      // resource attributes (which the fleet doesn't stamp).
      for (const l of checkoutRollout) {
        expect(l.logAttributes['service.version']).toBe(NEW_VERSION);
        expect(l.resourceAttributes['service.version']).toBeUndefined();
      }
      expect(OLD_VERSION).toBe('1.43.1');
    });
  });

  describe('distractors', () => {
    it('payment-service ran an INNOCENT completed rollout just before the incident', () => {
      // start event + one per pod (6) + completion event.
      expect(paymentRollout.length).toBe(8);
      const start = paymentRollout.find(l =>
        /rolling update started: version 3\.6\.2 -> 3\.7\.0/.test(l.body),
      );
      expect(start).toBeDefined();
      expect(start!.timestampMs).toBe(PAYMENT_DEPLOY_MS);
      const complete = paymentRollout.find(l =>
        /completed: 6\/6 pods updated to version 3\.7\.0/.test(l.body),
      );
      expect(complete).toBeDefined();
      expect(complete!.timestampMs).toBe(PAYMENT_COMPLETE_MS);
      // The trap geometry: payment's rollout completes BEFORE the checkout
      // errors begin — closest deploy to the onset, yet innocent.
      expect(PAYMENT_COMPLETE_MS).toBeLessThan(DEPLOY_MS);
    });

    it('payment-service is provably healthy on BOTH sides of its rollout', () => {
      const payment = result.traces.filter(
        t => t.serviceName === 'payment-service',
      );
      expect(payment.length).toBeGreaterThan(100);
      const byVersion = (v: string) =>
        payment.filter(t => t.resourceAttributes['service.version'] === v);
      expect(byVersion(PAYMENT_OLD_VERSION).length).toBeGreaterThan(20);
      expect(byVersion(PAYMENT_NEW_VERSION).length).toBeGreaterThan(20);
      for (const p of payment) {
        expect(p.statusCode).toBe('STATUS_CODE_OK');
        expect(p.durationNs / 1e6).toBeLessThan(300);
      }
    });

    it('deprecation WARN flood steps at the pod flips but is benign', () => {
      // Scales with volumeFactor: 6000 * 0.02 = 120 at the test factor.
      expect(floodLogs.length).toBe(120);
      // Outranks the sampled stack traces in any volume-ranked pattern list.
      expect(floodLogs.length).toBeGreaterThan(stackLogs.length * 5);
      for (const l of floodLogs) {
        expect(l.serviceName).toBe('checkout-api');
        expect(l.severityText).toBe('WARN');
        expect(l.body).toContain('DeprecationWarning');
        expect(l.body).toContain('session');
        expect(l.body).not.toMatch(/promo/i);
        // No trace correlation — it never touches a failed request.
        expect(l.traceId).toBeUndefined();
        // Emitted only by updated pods, only after their own flip: the
        // total rate steps up at the exact incident boundaries.
        const pod = l.resourceAttributes['k8s.pod.name'];
        expect(canaryPodNames.has(pod)).toBe(true);
        expect(l.timestampMs).toBeGreaterThanOrEqual(
          canaryFlipMsByPod.get(pod)!,
        );
      }
    });

    it('recommendation-service 502 burst PREDATES both deploys and self-resolves', () => {
      const burst = result.traces.filter(
        t =>
          t.serviceName === 'recommendation-service' &&
          t.statusCode === 'STATUS_CODE_ERROR',
      );
      expect(burst.length).toBe(150); // fixed planted volume
      for (const b of burst) {
        expect(b.timestampMs).toBeGreaterThanOrEqual(BURST_START_MS);
        expect(b.timestampMs).toBeLessThanOrEqual(BURST_END_MS);
        expect(b.spanAttributes['http.response.status_code']).toBe('502');
      }
      expect(BURST_END_MS).toBeLessThan(PAYMENT_DEPLOY_MS);
      expect(BURST_END_MS).toBeLessThan(DEPLOY_MS);
    });

    it('caught-exception noise runs at a constant rate across the deploy', () => {
      const decoy = result.logs.filter(
        l => l.logAttributes['error.kind'] === 'NonFatalRetryableError',
      );
      expect(decoy.length).toBeGreaterThan(50);
      const preMs = DEPLOY_MS - WINDOW_START_MS;
      const postMs = NOW_MS - DEPLOY_MS;
      const preRate =
        decoy.filter(l => l.timestampMs < DEPLOY_MS).length / preMs;
      const postRate =
        decoy.filter(l => l.timestampMs >= DEPLOY_MS).length / postMs;
      expect(postRate).toBeGreaterThan(preRate * 0.6);
      expect(postRate).toBeLessThan(preRate * 1.6);
    });
  });

  describe('metrics — corroborating only (the metrics-neutral property)', () => {
    it('metrics cannot reveal the pod split or the defect', () => {
      const serialized = JSON.stringify(m);
      expect(serialized).not.toContain(NEW_VERSION);
      expect(serialized).not.toMatch(/promo|percentOff|applyPromotion/i);
      expect(serialized).not.toContain('service.version');
      expect(serialized).not.toContain('k8s.pod.name');
    });

    it('5xx request counter (cumulative sum) slope changes at the deploy', () => {
      const fiveXx = m
        .sum!.filter(
          s =>
            s.metricName === 'http.server.request.count' &&
            s.attributes?.status_class === '5xx',
        )
        .sort((a, b) => a.timeUnixMs - b.timeUnixMs);
      for (let i = 1; i < fiveXx.length; i++) {
        expect(fiveXx[i].value).toBeGreaterThanOrEqual(fiveXx[i - 1].value);
      }
      const at = (ms: number) =>
        fiveXx.filter(p => p.timeUnixMs <= ms).pop()?.value ?? 0;
      const preDelta = at(DEPLOY_MS) - at(WINDOW_START_MS);
      const postDelta = at(NOW_MS) - at(LAST_FLIP_MS);
      const preScrapes = (DEPLOY_MS - WINDOW_START_MS) / 120_000;
      const postScrapes = (NOW_MS - LAST_FLIP_MS) / 120_000;
      expect(preDelta / preScrapes).toBeLessThan(2);
      expect(postDelta / postScrapes).toBeGreaterThan(10);
    });

    it('500-status latency histogram count steps up at the deploy', () => {
      const errHist = m.histogram!.filter(
        h =>
          h.metricName === 'http.server.request.duration' &&
          h.attributes?.['http.response.status_code'] === '500',
      );
      const preAvg =
        errHist
          .filter(h => h.timeUnixMs < DEPLOY_MS)
          .reduce((a, h) => a + h.count, 0) /
        ((DEPLOY_MS - WINDOW_START_MS) / 120_000);
      const postAvg =
        errHist
          .filter(h => h.timeUnixMs >= LAST_FLIP_MS)
          .reduce((a, h) => a + h.count, 0) /
        ((NOW_MS - LAST_FLIP_MS) / 120_000);
      expect(preAvg).toBeLessThan(2);
      expect(postAvg).toBeGreaterThan(10);
    });

    it('CPU and memory gauges stay flat and healthy (rules out infra)', () => {
      const cpu = m.gauge!.filter(
        g => g.metricName === 'system.cpu.utilization',
      );
      expect(cpu.length).toBeGreaterThan(0);
      for (const c of cpu) {
        expect(c.value).toBeGreaterThanOrEqual(0.2);
        expect(c.value).toBeLessThanOrEqual(0.35);
      }
      const mem = m.gauge!.filter(g => g.metricName === 'process.memory.usage');
      expect(mem.length).toBeGreaterThan(0);
      for (const g of mem) {
        const mb = g.value / 1024 / 1024;
        expect(mb).toBeGreaterThanOrEqual(460);
        expect(mb).toBeLessThanOrEqual(550);
      }
    });

    it('queue-depth red herring is noisy across the WHOLE window on a neighbor', () => {
      const q = m
        .gauge!.filter(g => g.metricName === 'inventory.sync.queue.depth')
        .sort((a, b) => a.timeUnixMs - b.timeUnixMs);
      expect(q.length).toBeGreaterThan(0);
      for (const g of q) expect(g.serviceName).toBe('inventory-service');
      // Present before the burst and after the deploy — uncorrelated with both.
      expect(q[0].timeUnixMs).toBeLessThan(BURST_START_MS);
      expect(q[q.length - 1].timeUnixMs).toBeGreaterThan(DEPLOY_MS);
    });
  });

  describe('rubric', () => {
    // An answer that engages every designed observation: the pod split,
    // the rollout-event join, the staggered onset, the promo cross-tab,
    // the sampled stack, quantified rates, and both co-timed traps.
    // One claim per line, bullet style — the answer shape agents actually
    // produce (the gap regexes are line-bounded, matching the negative-
    // check convention).
    const EXCELLENT_ANSWER = [
      'Root cause: the checkout-api 2.0.0-rc1 canary rollout.',
      '- The rolling update started at 12:54 and was paused at 3/6 pods for canary observation.',
      '- Errors ramp in three ~2-minute increments — a staggered onset, one step as each pod flips.',
      '- Grouping failed POST /api/checkout spans by k8s.pod.name shows the failures confined to 3 of 6 pods (~15% error rate each vs ~0.3% baseline on the rest).',
      '- Those are exactly the pods named in the deployment.rollout events ("updated to version 2.0.0-rc1").',
      '- Every failing request carries a fixed-amount promo code (FREESHIP, FLAT5, or GIFT10); percent codes succeed on every pod.',
      "- The stack trace — TypeError: Cannot read properties of undefined (reading 'percentOff') at applyPromotion — appears on only ~1-in-7 failures; most of the failures log only a generic checkout.request_failed line.",
      "What's not the cause:",
      '- The payment-service 3.7.0 rollout is innocent — it completed before the errors began, and payment.authorize is healthy on both versions. Failed checkouts never even reach payment-service.',
      '- The DeprecationWarning session-cookie flood from the new build is benign WARN noise with no trace correlation to the 500s.',
      '- The recommendation-service 502 burst predates both deploys and self-resolved. CPU and memory are flat.',
    ].join('\n');

    // A correct-but-shallow answer: right deploy, right service, but no
    // mechanism, no join, no quantification, no trap engagement. This is
    // the answer quality that used to score ~0.95 — it must now leave the
    // excellence-tier checks on the table.
    const GENERIC_GOOD_ANSWER = [
      'checkout-api is failing because of the 2.0.0-rc1 deploy — the new',
      'version introduced a bug in the promotion handling code. The rollout',
      'appears paused, and some checkouts on the new build return 500s.',
      'Rolling back checkout-api should fix it.',
      'The payment gateway looked fine.',
    ].join('\n');

    const EXCELLENCE_TIER = [
      'names_defect_mechanism',
      'names_fixed_amount_trigger',
      'cites_rollout_event_join',
      'names_staggered_onset',
      'notes_error_sampling',
      'quantifies_impact',
      'rules_out_payment_deploy',
      'rules_out_deprecation_flood',
    ];

    it('loads and includes transcript (adoption) checks', () => {
      const rubric = loadScenarioRubric('deploy-regression');
      expect(rubric.programmatic.length).toBeGreaterThan(0);
      expect(rubric.transcript?.length).toBe(2);
      expect(rubric.transcript![0].id).toBe('used_metric_tool');
    });

    it('negative checks do not fire on rule-out phrasing', () => {
      const rubric = loadScenarioRubric('deploy-regression');
      const ruleOut = [
        'The payment-service deploy is not the cause — payment.authorize is healthy on both versions.',
        'These failures are not caused by the payment-service rollout.',
        'The deprecation warnings are benign and not the root cause.',
        'The problem is not the session-cookie deprecation flood.',
        // Real rule-out phrasings that once tripped the tempered guards
        // (batch 2026-07-24T08-41-58: "no evidence" was not in the guard
        // list, so a correct dismissal was scored as false blame).
        'Deprecation warning ("legacy session-cookie format"): 6,000 WARN-level logs but no evidence these cause failures. Noise, not signal.',
        'payment-service v3.7.0 rollout: no evidence the deploy caused any checkout failures.',
        // Hypothesis-then-dismissal phrasings:
        // rule-out verbs before the subject, hedged causal verbs, interrogatives,
        // conditionals, and "because" (which contains "caus") must not be
        // scored as false blame.
        'I ruled out the payment-service deploy because payment spans were error-free.',
        'I ruled out the payment-service deploy as the cause of the checkout failures.',
        'At first glance the payment-service deploy looked like it caused the incident, but payment spans were error-free on both versions.',
        'Could the root cause be the payment-service deploy? No — payment-service showed zero errors on both versions.',
        'I checked whether the payment-service deploy caused the errors — it did not.',
        "It is not the payment-service deploy's fault; failed checkouts never reach payment-service.",
        'The session-cookie deprecation flood is noise because it never correlates with checkout errors.',
      ].join('\n');
      for (const check of rubric.programmatic) {
        if (!check.negative) continue;
        const re = new RegExp(check.pattern, check.flags ?? 'i');
        expect(`${check.id}:${re.test(ruleOut)}`).toBe(`${check.id}:false`);
      }
    });

    it('negative checks DO fire on blame phrasing', () => {
      const rubric = loadScenarioRubric('deploy-regression');
      const blame = new Map([
        [
          'false_blame_payment_deploy',
          [
            'The root cause is the payment-service rollout to 3.7.0.',
            'The payment-service deploy of 3.7.0 caused the checkout failures.',
            // Assertive hedges are still blame — only hypothesis framing
            // ("might", "could", "suspect") is protected.
            'The most likely root cause is the payment-service deploy.',
          ],
        ],
        [
          'false_blame_payment',
          ['Checkout failures are due to a payment-gateway outage.'],
        ],
        [
          'false_blame_deprecation',
          [
            'The failures are caused by the session-cookie deprecation in the new build.',
            'The session-cookie deprecation broke checkout session handling.',
          ],
        ],
      ]);
      for (const [id, texts] of blame) {
        const check = rubric.programmatic.find(c => c.id === id);
        expect(check).toBeDefined();
        const re = new RegExp(check!.pattern, check!.flags ?? 'i');
        for (const text of texts) {
          expect(`${id}:${re.test(text)}`).toBe(`${id}:true`);
        }
      }
    });

    it('every positive check passes on an excellent answer', () => {
      const rubric = loadScenarioRubric('deploy-regression');
      for (const check of rubric.programmatic) {
        if (check.negative) continue;
        const re = new RegExp(check.pattern, check.flags ?? 'i');
        expect(`${check.id}:${re.test(EXCELLENT_ANSWER)}`).toBe(
          `${check.id}:true`,
        );
      }
    });

    it('no negative check fires on the excellent answer (rule-outs stay safe)', () => {
      const rubric = loadScenarioRubric('deploy-regression');
      for (const check of rubric.programmatic) {
        if (!check.negative) continue;
        const re = new RegExp(check.pattern, check.flags ?? 'i');
        expect(`${check.id}:${re.test(EXCELLENT_ANSWER)}`).toBe(
          `${check.id}:false`,
        );
      }
    });

    it('excellence-tier checks FAIL on a good-but-generic answer (the old 0.95 ceiling)', () => {
      const rubric = loadScenarioRubric('deploy-regression');
      for (const id of EXCELLENCE_TIER) {
        const check = rubric.programmatic.find(c => c.id === id);
        expect(check).toBeDefined();
        const re = new RegExp(check!.pattern, check!.flags ?? 'i');
        expect(`${id}:${re.test(GENERIC_GOOD_ANSWER)}`).toBe(`${id}:false`);
      }
    });

    it('phrasing variants of real answers pass the fragile checks (regression)', () => {
      // Both from batch 2026-07-24T08-41-58: equal-quality answers diverged
      // on wording luck because the regexes demanded exact adjacency.
      const rubric = loadScenarioRubric('deploy-regression');
      const cases = new Map([
        // hyperdx/2 wrote "3 of 6 `checkout-api` pods" — words between the
        // count and "pods" must not break the match.
        [
          'cites_pod_split',
          'A deployment rolled out to 3 of 6 checkout-api pods.',
        ],
        // "v"-prefixed version spelling.
        [
          'cites_rollout_event_join',
          'The rollout events show those pods updated to v2.0.0-rc1.',
        ],
      ]);
      for (const [id, text] of cases) {
        const check = rubric.programmatic.find(c => c.id === id);
        expect(check).toBeDefined();
        const re = new RegExp(check!.pattern, check!.flags ?? 'i');
        expect(`${id}:${re.test(text)}`).toBe(`${id}:true`);
      }
    });

    it('base checks still pass on the good-but-generic answer', () => {
      const rubric = loadScenarioRubric('deploy-regression');
      for (const id of [
        'names_affected_service',
        'blames_the_deploy',
        'names_rollout_pause_or_partial',
      ]) {
        const check = rubric.programmatic.find(c => c.id === id);
        expect(check).toBeDefined();
        const re = new RegExp(check!.pattern, check!.flags ?? 'i');
        expect(`${id}:${re.test(GENERIC_GOOD_ANSWER)}`).toBe(`${id}:true`);
      }
    });
  });
});

describe('deploy-regression system prompt', () => {
  it('advertises the metric source with the exact metric-saturation note (parity)', () => {
    const noteRe =
      /- Metrics: a HyperDX metric source is available[\s\S]*?alongside traces and logs\./;
    const ours = buildSystemPrompt(
      deployRegressionScenario,
      '2026-05-10T20:00:00.000Z',
    );
    const theirs = buildSystemPrompt(
      metricSaturationScenario,
      '2026-05-10T20:00:00.000Z',
    );
    const ourNote = ours.match(noteRe)?.[0];
    const theirNote = theirs.match(noteRe)?.[0];
    expect(ourNote).toBeDefined();
    expect(ourNote).toBe(theirNote);
    // Still the default SRE investigation framing.
    expect(ours).toMatch(/You are an SRE/i);
  });

  it('appends the scenario-local budget-discipline note (and only here)', () => {
    const ours = buildSystemPrompt(
      deployRegressionScenario,
      '2026-05-10T20:00:00.000Z',
    );
    const theirs = buildSystemPrompt(
      metricSaturationScenario,
      '2026-05-10T20:00:00.000Z',
    );
    expect(ours).toContain('HARD BUDGETS');
    expect(ours).toMatch(/wall-clock limit/);
    expect(ours).toMatch(/Reserve the final turn/);
    // Scenario-local: metric-saturation's prompt is untouched.
    expect(theirs).not.toContain('HARD BUDGETS');
  });

  it('budgets 26 turns — the observable budget must bind before the 300s wall clock', () => {
    // Completed runs use 21-24 tool calls at ~9-11s each; 32 turns funded
    // wandering into the wall-clock cliff (half of batch 2026-07-24T08-41-58
    // timed out and was graded on interim notes).
    expect(deployRegressionScenario.maxTurns).toBe(26);
  });

  it('shows a SOFT answer checkpoint in the TURN BUDGET line, not the hard cap', () => {
    const ours = buildSystemPrompt(
      deployRegressionScenario,
      '2026-05-10T20:00:00.000Z',
      'baseline',
      deployRegressionScenario.maxTurns,
    );
    // cap (26) - margin (8): telling the agent "after ~26 calls, answer"
    // while the harness cuts at 26 is an instruction to get truncated.
    expect(ours).toContain('After ~18 tool calls');
    expect(ours).not.toContain('After ~26 tool calls');
  });

  it('overrides the judge preamble to forbid crediting unstated claims', () => {
    // Truncated interim notes must grade deterministically (~0), not as a
    // coin flip on how much diagnosis the judge fills in from ground truth.
    expect(deployRegressionScenario.judgeSystemPreamble).toContain(
      'SCORE ONLY WHAT IS WRITTEN',
    );
    expect(deployRegressionScenario.judgeSystemPreamble).toContain(
      'Return STRICT JSON',
    );
  });
});
