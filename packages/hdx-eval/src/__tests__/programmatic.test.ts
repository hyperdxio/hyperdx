import {
  metricKeyToRegex,
  runAdoptionChecks,
  runProgrammaticChecks,
  serializeToolCallArgs,
} from '@/grading/programmatic';
import { loadScenarioRubric } from '@/grading/rubric';
import type { ToolCallRecord } from '@/harness/types';

function toolCall(name: string, input: unknown = null): ToolCallRecord {
  return {
    name,
    input,
    output: null,
    isError: false,
    startedAt: '',
    endedAt: null,
    durationMs: null,
  };
}

describe('runProgrammaticChecks', () => {
  it('hits all checks when answer mentions every required fact', () => {
    const checks = [
      { id: 'a', weight: 1, pattern: 'foo' },
      { id: 'b', weight: 2, pattern: 'bar' },
    ];
    const result = runProgrammaticChecks('foo and bar are present', checks);
    expect(result.score).toBeCloseTo(1, 5);
    expect(result.hits.every(h => h.matched)).toBe(true);
  });

  it('weights hits proportionally', () => {
    const checks = [
      { id: 'a', weight: 1, pattern: 'foo' }, // matches → +1
      { id: 'b', weight: 3, pattern: 'BAR', flags: '' }, // case-sensitive miss
    ];
    const result = runProgrammaticChecks('only foo here', checks);
    // 1 / (1+3) = 0.25
    expect(result.score).toBeCloseTo(0.25, 5);
  });

  it('defaults flags to case-insensitive', () => {
    const checks = [{ id: 'a', weight: 1, pattern: 'PAYMENT-SERVICE' }];
    const result = runProgrammaticChecks(
      'mentions payment-service here',
      checks,
    );
    expect(result.hits[0].matched).toBe(true);
  });

  it('throws on invalid regex', () => {
    expect(() =>
      runProgrammaticChecks('any', [{ id: 'a', weight: 1, pattern: '(' }]),
    ).toThrow();
  });

  it('returns 0 score for empty checks list', () => {
    expect(runProgrammaticChecks('anything', []).score).toBe(0);
  });

  it('error-root-cause rubric scores 100% on a strong answer that hits every multi-criterion check', () => {
    const rubric = loadScenarioRubric('error-root-cause');
    const answer =
      'Root cause: payment-service ConnectionTimeoutError on db.payment.connect ' +
      'reaching db-payment.internal — DB connection timeout — cascading into ' +
      'checkout-api 5xx errors. Ruled out concurrent SMTP and CDN origin bursts ' +
      '(separate trace trees, no checkout parent) and the historical TLS / ' +
      'rate-limit incidents.';
    const result = runProgrammaticChecks(answer, rubric.programmatic);
    expect(result.score).toBeCloseTo(1, 5);
  });

  it('error-root-cause rubric drops below saturation when the answer is generic (no error.type / db host / distractor rule-out)', () => {
    const rubric = loadScenarioRubric('error-root-cause');
    const genericAnswer =
      'Root cause is payment-service connection timeout to db-payment, ' +
      'cascading into checkout-api 5xx errors.';
    const result = runProgrammaticChecks(genericAnswer, rubric.programmatic);
    // Pre-tightening, this answer scored 1.0. Now it misses
    // names_db_host_fqdn (full db-payment.internal), names_specific_db_span
    // (db.payment.connect), and ruled_out_a_distractor — should land
    // measurably below 1.0.
    expect(result.score).toBeLessThan(0.9);
    expect(result.score).toBeGreaterThan(0.5);
  });

  it('error-root-cause rubric scores noticeably worse on an irrelevant answer than a correct one', () => {
    const rubric = loadScenarioRubric('error-root-cause');
    const irrelevant = runProgrammaticChecks(
      'I think the database needs more memory.',
      rubric.programmatic,
    );
    const correct = runProgrammaticChecks(
      'Root cause is payment-service connection timeout to db-payment, ' +
        'cascading into checkout-api 5xx errors.',
      rubric.programmatic,
    );
    // Irrelevant answers vacuously satisfy the negative checks (they don't
    // blame anything) but miss every positive — leaves a clear gap below the
    // correct answer.
    expect(correct.score - irrelevant.score).toBeGreaterThan(0.3);
    expect(irrelevant.score).toBeLessThan(correct.score);
  });

  it('negative check is satisfied when the pattern does NOT match', () => {
    const checks = [
      { id: 'a', weight: 1, pattern: 'foo' }, // positive, miss
      { id: 'b', weight: 1, pattern: 'baz', negative: true }, // negative, miss → satisfied
    ];
    const result = runProgrammaticChecks('only bar here', checks);
    expect(result.hits[0]).toMatchObject({ matched: false, satisfied: false });
    expect(result.hits[1]).toMatchObject({
      matched: false,
      satisfied: true,
      negative: true,
    });
    // 1 / (1+1) = 0.5
    expect(result.score).toBeCloseTo(0.5, 5);
  });

  it('negative check is unsatisfied when the pattern DOES match', () => {
    const checks = [
      { id: 'a', weight: 1, pattern: 'foo' }, // positive, hit
      { id: 'b', weight: 2, pattern: 'BAR', negative: true }, // negative, hit → unsatisfied
    ];
    const result = runProgrammaticChecks('foo and bar', checks);
    expect(result.hits[1]).toMatchObject({
      matched: true,
      satisfied: false,
      negative: true,
    });
    // 1 / (1+2) = 0.333
    expect(result.score).toBeCloseTo(1 / 3, 5);
  });

  it('error-root-cause rubric penalizes blaming a distractor as root cause', () => {
    const rubric = loadScenarioRubric('error-root-cause');
    const goodAnswer =
      'Root cause: payment-service ConnectionTimeoutError on db.payment.connect ' +
      'reaching db-payment.internal — DB connection timeout — cascading into ' +
      'checkout-api 5xx. Ruled out concurrent SMTP and CDN bursts ' +
      '(separate trace trees) and historical TLS / rate-limit incidents.';
    const goodResult = runProgrammaticChecks(goodAnswer, rubric.programmatic);

    const wrongBlameAnswer =
      'Root cause is the SMTP connection refused error on notification-service. ' +
      'payment-service db-payment connection timeout into checkout-api also seen.';
    const wrongResult = runProgrammaticChecks(
      wrongBlameAnswer,
      rubric.programmatic,
    );

    expect(goodResult.score).toBeGreaterThan(0.95);
    // Wrong blame should drop score below 1 even though all positive checks still hit.
    expect(wrongResult.score).toBeLessThan(goodResult.score);
  });
});

describe('serializeToolCallArgs', () => {
  it('serializes input args as compact JSON, excluding the tool name', () => {
    const s = serializeToolCallArgs(
      toolCall('clickstack_describe_metric', {
        name: 'process.runtime.jvm.memory.used',
      }),
    );
    expect(s).toBe('{"name":"process.runtime.jvm.memory.used"}');
    expect(s).not.toContain('clickstack_describe_metric');
  });

  it('returns an empty string when there are no args', () => {
    expect(serializeToolCallArgs(toolCall('clickstack_list_sources'))).toBe('');
  });

  it('passes through string input verbatim (no double-encoding)', () => {
    expect(serializeToolCallArgs(toolCall('raw', 'already a string'))).toBe(
      'already a string',
    );
  });

  it('does not throw on circular / unserializable input', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(serializeToolCallArgs(toolCall('weird', circular))).toBe(
      '[unserializable]',
    );
  });

  it('truncates oversized args so one huge call cannot bloat matching', () => {
    const big = 'x'.repeat(50_000);
    const s = serializeToolCallArgs(toolCall('huge', { blob: big }));
    expect(s.length).toBeLessThan(20_100);
    expect(s.endsWith('…')).toBe(true);
  });
});

describe('metricKeyToRegex', () => {
  it('matches the dotted key and its underscore variant, case-insensitively', () => {
    const rx = metricKeyToRegex('jvm.gc.pause');
    expect(rx.test("MetricName = 'jvm.gc.pause'")).toBe(true);
    expect(rx.test('rate(jvm_gc_pause[5m])')).toBe(true);
    expect(rx.test('JVM.GC.PAUSE')).toBe(true);
  });

  it('requires the full key — separator prose does not match', () => {
    const rx = metricKeyToRegex('jvm.gc.pause');
    expect(rx.test('the gc pause distribution grew a tail')).toBe(false);
    expect(rx.test('jvm gc pause')).toBe(false); // spaces are not separators
    expect(rx.test('jvmXgcXpause')).toBe(false); // dots are not wildcards
  });

  it('escapes regex metacharacters in the key', () => {
    const rx = metricKeyToRegex('queue.depth{p99}');
    expect(rx.test('queue.depth{p99}')).toBe(true);
    expect(() => rx.test('anything')).not.toThrow();
  });
});

describe('runAdoptionChecks', () => {
  const gcCheck = {
    id: 'queried_gc_metric',
    weight: 1,
    metrics: ['jvm.gc.pause'],
  };

  it('counts a dedicated metric tool naming the metric in its args', () => {
    const result = runAdoptionChecks(
      [
        toolCall('mcp__hyperdx__clickstack_timeseries', {
          metricType: 'histogram',
          metricName: 'jvm.gc.pause',
        }),
      ],
      [gcCheck],
    );
    expect(result.score).toBeCloseTo(1, 5);
    expect(result.hits[0].satisfied).toBe(true);
  });

  it('counts raw SQL naming the metric — detection is tool-name-agnostic', () => {
    const result = runAdoptionChecks(
      [
        toolCall('mcp__clickhouse__run_query', {
          query:
            "SELECT * FROM otel_metrics_exponential_histogram WHERE MetricName = 'jvm.gc.pause'",
        }),
      ],
      [gcCheck],
    );
    expect(result.score).toBeCloseTo(1, 5);
  });

  it('ignores metric names that only appear in tool OUTPUT', () => {
    const call: ToolCallRecord = {
      ...toolCall('mcp__hyperdx__clickstack_list_metrics', { sourceId: 's1' }),
      output: 'jvm.gc.pause\nprocess.runtime.jvm.memory.used',
    };
    const result = runAdoptionChecks([call], [gcCheck]);
    expect(result.score).toBe(0);
    expect(result.hits[0].satisfied).toBe(false);
  });

  it('ignores tool NAMES — a metric-ish tool name is not adoption', () => {
    const result = runAdoptionChecks(
      [toolCall('query_jvm.gc.pause_tool', { sourceId: 's1' })],
      [gcCheck],
    );
    expect(result.score).toBe(0);
  });

  it('scores zero when there are no tool calls', () => {
    const result = runAdoptionChecks([], [gcCheck]);
    expect(result.score).toBe(0);
    expect(result.hits[0].satisfied).toBe(false);
  });

  it('alsoPattern must match the SAME call as the metric key', () => {
    const grouped = {
      id: 'grouped_memory_by_pod_or_pool',
      weight: 1,
      metrics: ['process.runtime.jvm.memory.used'],
      alsoPattern: 'pool|pod',
    };
    // Metric in one call, "pod" in a different call → NOT satisfied.
    const split = runAdoptionChecks(
      [
        toolCall('a', { metric: 'process.runtime.jvm.memory.used' }),
        toolCall('b', { groupBy: 'k8s.pod.name' }),
      ],
      [grouped],
    );
    expect(split.hits[0].satisfied).toBe(false);
    // Both in the same call (SQL, no dedicated tool) → satisfied.
    const together = runAdoptionChecks(
      [
        toolCall('mcp__clickhouse__run_query', {
          query:
            "SELECT avg(Value) FROM otel_metrics_gauge WHERE MetricName = 'process.runtime.jvm.memory.used' GROUP BY Attributes['k8s.pod.name']",
        }),
      ],
      [grouped],
    );
    expect(together.hits[0].satisfied).toBe(true);
  });

  it('throws on an invalid alsoPattern', () => {
    expect(() =>
      runAdoptionChecks(
        [toolCall('a', { metric: 'jvm.gc.pause' })],
        [{ id: 'bad', weight: 1, metrics: ['jvm.gc.pause'], alsoPattern: '(' }],
      ),
    ).toThrow(/alsoPattern/);
  });
});

describe('rubric.adoption parsing', () => {
  it('hydrates the metric-saturation adoption block', () => {
    const rubric = loadScenarioRubric('metric-saturation');
    expect(rubric.adoption).toBeDefined();
    expect(rubric.adoption!.length).toBeGreaterThanOrEqual(1);
    const umbrella = rubric.adoption!.find(
      c => c.id === 'queried_target_metric',
    );
    expect(umbrella).toMatchObject({ weight: 1 });
    expect(umbrella!.metrics).toContain('process.runtime.jvm.memory.used');
  });

  it('leaves adoption undefined for scenarios without the block', () => {
    const rubric = loadScenarioRubric('error-root-cause');
    expect(rubric.adoption).toBeUndefined();
  });

  it('every declared metric key compiles into a valid regex', () => {
    for (const scenario of ['metric-saturation', 'deploy-regression']) {
      const rubric = loadScenarioRubric(scenario);
      for (const c of rubric.adoption!) {
        for (const key of c.metrics) {
          expect(() => metricKeyToRegex(key)).not.toThrow();
        }
      }
    }
  });
});

describe('metric-saturation adoption checks (args-based, arm-agnostic)', () => {
  const rubric = () => loadScenarioRubric('metric-saturation').adoption!;
  const satisfiedIds = (calls: ToolCallRecord[]) =>
    runAdoptionChecks(calls, rubric())
      .hits.filter(h => h.satisfied)
      .map(h => h.id)
      .sort();

  it('raw SQL naming the target metrics gets adoption credit (clickhouse arm)', () => {
    // The whole point of args-based detection: a clickhouse-arm run that
    // investigates the metrics via SQL counts the same as metric-tool usage.
    const ids = satisfiedIds([
      toolCall('mcp__clickhouse__run_query', {
        query:
          "SELECT MetricName, Value FROM otel_metrics_gauge WHERE MetricName IN ('process.runtime.jvm.memory.used', 'jvm.gc.pause')",
      }),
    ]);
    expect(ids).toEqual([
      'queried_gc_metric',
      'queried_jvm_memory_metric',
      'queried_target_metric',
    ]);
  });

  it('metric-tool calls naming the metrics satisfy the same checks (hyperdx arm)', () => {
    const ids = satisfiedIds([
      toolCall('mcp__hyperdx__clickstack_describe_metric', {
        sourceId: 's1',
        metricType: 'gauge',
        name: 'process.runtime.jvm.memory.used',
      }),
      toolCall('mcp__hyperdx__clickstack_timeseries', {
        sourceId: 's1',
        metricType: 'histogram',
        metricName: 'jvm.gc.pause',
      }),
    ]);
    expect(ids).toEqual([
      'queried_gc_metric',
      'queried_jvm_memory_metric',
      'queried_target_metric',
    ]);
  });

  it('grouping the memory metric by pod/pool in the same call satisfies the grouped check', () => {
    const ids = satisfiedIds([
      toolCall('mcp__hyperdx__clickstack_timeseries', {
        metricType: 'gauge',
        metric: 'process.runtime.jvm.memory.used',
        groupBy: ['k8s.pod.name', 'jvm.memory.pool.name'],
      }),
    ]);
    expect(ids).toContain('grouped_memory_by_pod_or_pool');
  });

  it('a bare list_metrics call (no metric named in args) does not count', () => {
    const ids = satisfiedIds([
      toolCall('mcp__hyperdx__clickstack_list_metrics', { sourceId: 's1' }),
    ]);
    expect(ids).toEqual([]);
  });

  it('a log search mentioning "gc pause" prose does not count', () => {
    // Full metric keys are required — casual prose in a log-body filter must
    // not earn metric-adoption credit.
    const ids = satisfiedIds([
      toolCall('mcp__hyperdx__clickstack_search', {
        sourceId: 'logs-source',
        where: "Body LIKE '%gc pause%'",
      }),
    ]);
    expect(ids).toEqual([]);
  });
});
