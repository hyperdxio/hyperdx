import type { Rubric } from './types';

const SYSTEM_PREAMBLE = `You are evaluating an SRE investigation. You will receive:
- the scenario question (what the candidate was asked)
- the ground-truth facts (the planted answer the candidate did NOT see)
- a rubric with weighted criteria
- the candidate's final answer (anonymized — tool names and product brands have been redacted so you cannot tell which tool the candidate used)

For each rubric criterion, output an integer score from 0 to 5 plus a one-sentence rationale. Do not consider tool choice, query syntax, or implementation details — score only the quality of the candidate's final answer relative to the ground truth.

Return STRICT JSON of shape:
{ "scores": { "<criterion_id>": { "score": N, "rationale": "..." } } }
No prose outside the JSON. Include every criterion id from the rubric.`;

export function buildJudgeSystem(
  scenarioName: string,
  rubric: Rubric,
  /** Custom system preamble from a scenario hook. */
  customPreamble?: string,
): string {
  const criteriaSection = rubric.judge.criteria
    .map(c => `- "${c.id}" (weight ${c.weight}): ${c.description}`)
    .join('\n');
  return [
    customPreamble ?? SYSTEM_PREAMBLE,
    '',
    `SCENARIO: ${scenarioName}`,
    '',
    'RUBRIC CRITERIA:',
    criteriaSection,
  ].join('\n');
}

export function buildJudgeUser(args: {
  scenarioPrompt: string;
  groundTruthFacts: string;
  candidateAnswer: string;
  /** Dashboard artifact evidence — appended for dashboard scenarios. */
  dashboardEvidence?: string;
}): string {
  const sections = [
    'SCENARIO QUESTION:',
    args.scenarioPrompt,
    '',
    'GROUND-TRUTH FACTS (internal only — the candidate did not see these):',
    args.groundTruthFacts,
    '',
    'CANDIDATE FINAL ANSWER (anonymized):',
    args.candidateAnswer,
  ];

  if (args.dashboardEvidence) {
    sections.push('', args.dashboardEvidence);
  }

  return sections.join('\n');
}

/**
 * Renders the `expected` and `anomalyAttributes` portions of a scenario
 * ground-truth.json as a human-readable bulleted summary for the judge.
 * Strips internal-only fields (rubric, agentPrompt, scenario name).
 */
export function formatGroundTruthFacts(groundTruth: unknown): string {
  if (!groundTruth || typeof groundTruth !== 'object') return '(none)';
  const gt = groundTruth as Record<string, unknown>;
  const lines: string[] = [];
  const expected = gt.expected;
  if (expected && typeof expected === 'object') {
    lines.push('Expected:');
    for (const [k, v] of Object.entries(expected)) {
      lines.push(`  - ${k}: ${formatValue(v)}`);
    }
  }
  const anomaly = gt.anomalyAttributes;
  if (anomaly && typeof anomaly === 'object') {
    lines.push('Anomaly attributes:');
    for (const [k, v] of Object.entries(anomaly)) {
      lines.push(`  - ${k}: ${formatValue(v)}`);
    }
  }
  return lines.join('\n');
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}
