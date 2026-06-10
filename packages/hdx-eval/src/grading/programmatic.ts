import type {
  ProgrammaticCheck,
  ProgrammaticHit,
  ProgrammaticResult,
} from './types';

export function runProgrammaticChecks(
  answer: string,
  checks: ProgrammaticCheck[],
): ProgrammaticResult {
  const hits: ProgrammaticHit[] = [];
  let totalWeight = 0;
  let hitWeight = 0;

  for (const check of checks) {
    totalWeight += check.weight;
    const flags = check.flags ?? 'i';
    let regex: RegExp;
    try {
      regex = new RegExp(check.pattern, flags);
    } catch (err) {
      throw new Error(
        `Invalid regex in programmatic check '${check.id}': ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    const matched = regex.test(answer);
    const satisfied = check.negative ? !matched : matched;
    if (satisfied) hitWeight += check.weight;
    hits.push({
      id: check.id,
      weight: check.weight,
      matched,
      satisfied,
      negative: check.negative,
    });
  }

  const score = totalWeight === 0 ? 0 : hitWeight / totalWeight;
  return { hits, score };
}
