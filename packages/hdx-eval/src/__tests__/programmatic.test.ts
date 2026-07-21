import {
  runProgrammaticChecks,
  runTranscriptChecks,
  serializeTranscript,
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

describe('serializeTranscript', () => {
  it('serializes each call as `<name> <compact-json-args>`, one per line', () => {
    const s = serializeTranscript([
      toolCall('clickstack_list_metrics', { sourceId: 's1' }),
      toolCall('clickstack_describe_metric', {
        name: 'process.runtime.jvm.memory.used',
      }),
    ]);
    expect(s).toBe(
      'clickstack_list_metrics {"sourceId":"s1"}\n' +
        'clickstack_describe_metric {"name":"process.runtime.jvm.memory.used"}',
    );
  });

  it('emits the bare tool name when there are no args', () => {
    expect(serializeTranscript([toolCall('clickstack_list_sources')])).toBe(
      'clickstack_list_sources',
    );
  });

  it('passes through string input verbatim (no double-encoding)', () => {
    expect(serializeTranscript([toolCall('raw', 'already a string')])).toBe(
      'raw already a string',
    );
  });

  it('returns an empty string for no tool calls', () => {
    expect(serializeTranscript([])).toBe('');
  });

  it('does not throw on circular / unserializable input', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const s = serializeTranscript([toolCall('weird', circular)]);
    expect(s).toBe('weird [unserializable]');
  });

  it('truncates oversized args so one huge call cannot bloat the transcript', () => {
    const big = 'x'.repeat(5000);
    const s = serializeTranscript([toolCall('huge', { blob: big })]);
    expect(s.length).toBeLessThan(2100);
    expect(s.endsWith('…')).toBe(true);
  });
});

describe('runTranscriptChecks', () => {
  it('matches tool names in the serialized transcript', () => {
    const result = runTranscriptChecks(
      [
        toolCall('clickstack_list_metrics', { sourceId: 's1' }),
        toolCall('clickstack_sql', { sql: 'SELECT 1' }),
      ],
      [
        {
          id: 'used_metric_tool',
          weight: 1,
          pattern: 'clickstack_list_metrics',
        },
      ],
    );
    expect(result.score).toBeCloseTo(1, 5);
    expect(result.hits[0].satisfied).toBe(true);
  });

  it('matches on tool args, enabling "used the right metric" checks', () => {
    const checks = [
      {
        id: 'named_jvm_memory',
        weight: 1,
        pattern: 'process\\.runtime\\.jvm\\.memory',
      },
    ];
    const usedRight = runTranscriptChecks(
      [
        toolCall('clickstack_describe_metric', {
          name: 'process.runtime.jvm.memory.used',
        }),
      ],
      checks,
    );
    const usedWrong = runTranscriptChecks(
      [
        toolCall('clickstack_describe_metric', {
          name: 'http.server.duration',
        }),
      ],
      checks,
    );
    expect(usedRight.score).toBeCloseTo(1, 5);
    expect(usedWrong.score).toBe(0);
  });

  it('scores zero when the transcript is empty', () => {
    const result = runTranscriptChecks(
      [],
      [{ id: 'used_metric_tool', weight: 1, pattern: 'clickstack' }],
    );
    expect(result.score).toBe(0);
    expect(result.hits[0].satisfied).toBe(false);
  });
});

describe('rubric.transcript parsing', () => {
  it('hydrates the metric-saturation transcript block', () => {
    const rubric = loadScenarioRubric('metric-saturation');
    expect(rubric.transcript).toBeDefined();
    expect(rubric.transcript!.length).toBeGreaterThanOrEqual(1);
    // Tuples hydrate into full ProgrammaticCheck objects with default flags.
    const used = rubric.transcript!.find(c => c.id === 'used_metric_tool');
    expect(used).toMatchObject({ weight: 1, flags: 'i' });
    expect(typeof used!.pattern).toBe('string');
  });

  it('leaves transcript undefined for scenarios without the block', () => {
    const rubric = loadScenarioRubric('error-root-cause');
    expect(rubric.transcript).toBeUndefined();
  });

  it('the metric-saturation transcript checks all compile as valid regexes', () => {
    const rubric = loadScenarioRubric('metric-saturation');
    for (const c of rubric.transcript!) {
      expect(() => new RegExp(c.pattern, c.flags ?? 'i')).not.toThrow();
    }
  });
});
