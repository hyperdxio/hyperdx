import {
  buildJudgeSystem,
  buildJudgeUser,
  formatGroundTruthFacts,
} from '@/grading/judgePrompt';
import { loadScenarioRubric } from '@/grading/rubric';
import { getScenario } from '@/scenarios';

describe('buildJudgeSystem', () => {
  it('includes the scenario name and every criterion in the rubric', () => {
    const rubric = loadScenarioRubric('error-root-cause');
    const sys = buildJudgeSystem('error-root-cause', rubric);
    expect(sys).toContain('SCENARIO: error-root-cause');
    for (const c of rubric.judge.criteria) {
      expect(sys).toContain(`"${c.id}"`);
      expect(sys).toContain(c.description);
    }
  });

  it('instructs strict JSON output', () => {
    const rubric = loadScenarioRubric('latency-spike');
    const sys = buildJudgeSystem('latency-spike', rubric);
    expect(sys).toMatch(/STRICT JSON/);
    expect(sys).toMatch(/"scores"/);
  });

  it('asks the judge to ignore tool choice', () => {
    const rubric = loadScenarioRubric('noisy-signals');
    const sys = buildJudgeSystem('noisy-signals', rubric);
    expect(sys.toLowerCase()).toContain('tool choice');
  });

  it('defines explicit 0-5 scoring anchors so scores are calibrated across models', () => {
    const rubric = loadScenarioRubric('latency-spike');
    const sys = buildJudgeSystem('latency-spike', rubric);
    expect(sys).toMatch(/SCORING SCALE/i);
    // Every integer anchor 0..5 must be documented.
    for (const n of [0, 1, 2, 3, 4, 5]) {
      expect(sys).toMatch(new RegExp(`^- ${n} —`, 'm'));
    }
    // And it must instruct independent per-criterion scoring.
    expect(sys.toLowerCase()).toContain('independently');
  });
});

describe('buildJudgeUser', () => {
  it('includes the scenario question, ground truth, and candidate answer', () => {
    const user = buildJudgeUser({
      scenarioPrompt: 'Why is checkout failing?',
      groundTruthFacts: '- root cause: payment-service',
      candidateAnswer: 'It is the payment service.',
    });
    expect(user).toContain('Why is checkout failing?');
    expect(user).toContain('root cause: payment-service');
    expect(user).toContain('It is the payment service.');
  });
});

describe('formatGroundTruthFacts', () => {
  it('renders nested expected fields as bullets', () => {
    const scenario = getScenario('error-root-cause');
    const out = formatGroundTruthFacts(scenario.groundTruth);
    expect(out).toContain('rootCauseService: payment-service');
    expect(out).toContain('errorBodyPattern: db-payment');
  });

  it('handles arrays/objects via JSON for non-scalar values', () => {
    const scenario = getScenario('noisy-signals');
    const out = formatGroundTruthFacts(scenario.groundTruth);
    // compositeCells is an array — it gets JSON-stringified
    expect(out).toContain('compositeCells:');
    expect(out).toContain('inventory');
  });
});
