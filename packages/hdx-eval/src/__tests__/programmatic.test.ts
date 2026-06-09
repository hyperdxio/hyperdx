import { runProgrammaticChecks } from '../grading/programmatic';
import { loadScenarioRubric } from '../grading/rubric';

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
