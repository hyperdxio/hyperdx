import { getScenario } from '../scenarios';
import type { Rubric } from './types';

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

export function getScenarioGroundTruth(scenarioName: string): unknown {
  return getScenario(scenarioName).groundTruth;
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
  for (const c of obj.programmatic as unknown[]) {
    if (!c || typeof c !== 'object') {
      throw new Error(
        `rubric.programmatic for '${scenarioName}' has a non-object entry`,
      );
    }
    const check = c as Record<string, unknown>;
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
    if (check.negative !== undefined && typeof check.negative !== 'boolean') {
      throw new Error(
        `rubric.programmatic for '${scenarioName}': check '${check.id}' 'negative' must be a boolean`,
      );
    }
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
  return raw as Rubric;
}
