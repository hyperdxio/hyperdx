import { getScenario } from '@/scenarios';

import type { AdoptionCheck, ProgrammaticCheck, Rubric } from './types';

export function loadScenarioRubric(scenarioName: string): Rubric {
  const scenario = getScenario(scenarioName);
  const gt = scenario.groundTruth as { rubric?: unknown };
  if (!gt || typeof gt !== 'object' || !gt.rubric) {
    throw new Error(
      `Scenario '${scenarioName}' has no \`rubric\` block in ground-truth.json`,
    );
  }
  return validateRubric(gt.rubric, scenarioName);
}

/**
 * Hydrate a compact tuple `[id, weight, pattern, negative?]` into a
 * ProgrammaticCheck object. The `flags` field always defaults to `"i"`.
 */
function hydrateCheck(entry: unknown, scenarioName: string): ProgrammaticCheck {
  if (Array.isArray(entry)) {
    const [id, weight, pattern, negative] = entry;
    if (
      typeof id !== 'string' ||
      typeof weight !== 'number' ||
      typeof pattern !== 'string'
    ) {
      throw new Error(
        `rubric.programmatic for '${scenarioName}': tuple must be [string, number, string, boolean?]`,
      );
    }
    return {
      id,
      weight,
      pattern,
      flags: 'i',
      ...(negative === true ? { negative: true } : {}),
    };
  }
  if (!entry || typeof entry !== 'object') {
    throw new Error(
      `rubric.programmatic for '${scenarioName}' has a non-object/non-array entry`,
    );
  }
  const check = entry as Record<string, unknown>;
  if (typeof check.id !== 'string' || typeof check.pattern !== 'string') {
    throw new Error(
      `rubric.programmatic for '${scenarioName}': each check needs string 'id' and 'pattern'`,
    );
  }
  if (typeof check.weight !== 'number' || check.weight <= 0) {
    throw new Error(
      `rubric.programmatic for '${scenarioName}': check '${check.id}' weight must be a positive number`,
    );
  }
  return entry as ProgrammaticCheck;
}

/**
 * Validate an `adoption` check entry. Unlike programmatic checks these are
 * NOT regex tuples: each entry is an object declaring the target metric
 * names/keys the tool-call args must contain (see {@link AdoptionCheck}).
 * `alsoPattern` is compiled eagerly so a bad regex fails at rubric load, not
 * mid-grade.
 */
function validateAdoptionCheck(
  entry: unknown,
  scenarioName: string,
): AdoptionCheck {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(
      `rubric.adoption for '${scenarioName}': each check must be an object ` +
        `{ id, weight, metrics[], alsoPattern?, informational? } — tuples/patterns are not supported`,
    );
  }
  const check = entry as Record<string, unknown>;
  if (typeof check.id !== 'string') {
    throw new Error(
      `rubric.adoption for '${scenarioName}': each check needs a string 'id'`,
    );
  }
  if (
    check.informational !== undefined &&
    typeof check.informational !== 'boolean'
  ) {
    throw new Error(
      `rubric.adoption for '${scenarioName}': check '${check.id}' informational must be a boolean`,
    );
  }
  if (check.informational === true) {
    // Informational checks are excluded from the score — weight is optional
    // and ignored, but reject nonsense values to catch typos.
    if (
      check.weight !== undefined &&
      (typeof check.weight !== 'number' || check.weight < 0)
    ) {
      throw new Error(
        `rubric.adoption for '${scenarioName}': check '${check.id}' weight, when present on an informational check, must be a non-negative number`,
      );
    }
  } else if (typeof check.weight !== 'number' || check.weight <= 0) {
    throw new Error(
      `rubric.adoption for '${scenarioName}': check '${check.id}' weight must be a positive number`,
    );
  }
  if (
    !Array.isArray(check.metrics) ||
    check.metrics.length === 0 ||
    check.metrics.some(m => typeof m !== 'string' || m.length === 0)
  ) {
    throw new Error(
      `rubric.adoption for '${scenarioName}': check '${check.id}' needs a non-empty 'metrics' string array`,
    );
  }
  if (check.alsoPattern !== undefined) {
    if (typeof check.alsoPattern !== 'string') {
      throw new Error(
        `rubric.adoption for '${scenarioName}': check '${check.id}' alsoPattern must be a string`,
      );
    }
    try {
      new RegExp(check.alsoPattern, 'i');
    } catch (err) {
      throw new Error(
        `rubric.adoption for '${scenarioName}': check '${check.id}' alsoPattern is not a valid regex: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return entry as AdoptionCheck;
}

function validateRubric(raw: unknown, scenarioName: string): Rubric {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`rubric for '${scenarioName}' must be an object`);
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.programmatic)) {
    throw new Error(
      `rubric.programmatic for '${scenarioName}' must be an array`,
    );
  }
  const programmatic = (obj.programmatic as unknown[]).map(c =>
    hydrateCheck(c, scenarioName),
  );

  // Optional metric-adoption checks: declared target metric keys matched
  // against tool-call args (never tool names/outputs). Absent ⇒ scenario has
  // no adoption grading.
  let adoption: AdoptionCheck[] | undefined;
  if (obj.adoption !== undefined) {
    if (!Array.isArray(obj.adoption)) {
      throw new Error(`rubric.adoption for '${scenarioName}' must be an array`);
    }
    adoption = (obj.adoption as unknown[]).map(c =>
      validateAdoptionCheck(c, scenarioName),
    );
  }

  const judge = obj.judge as { criteria?: unknown } | undefined;
  if (!judge || !Array.isArray(judge.criteria) || judge.criteria.length === 0) {
    throw new Error(
      `rubric.judge.criteria for '${scenarioName}' must be a non-empty array`,
    );
  }
  for (const c of judge.criteria as unknown[]) {
    if (!c || typeof c !== 'object') {
      throw new Error(
        `rubric.judge.criteria for '${scenarioName}' has a non-object entry`,
      );
    }
    const crit = c as Record<string, unknown>;
    if (typeof crit.id !== 'string' || typeof crit.description !== 'string') {
      throw new Error(
        `rubric.judge.criteria for '${scenarioName}': each criterion needs string 'id' and 'description'`,
      );
    }
    if (typeof crit.weight !== 'number' || crit.weight <= 0) {
      throw new Error(
        `rubric.judge.criteria for '${scenarioName}': criterion '${crit.id}' weight must be a positive number`,
      );
    }
  }
  return {
    programmatic,
    judge: judge as Rubric['judge'],
    ...(adoption ? { adoption } : {}),
  };
}
