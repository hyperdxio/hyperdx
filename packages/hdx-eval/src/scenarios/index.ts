import { dashboardBuildScenario } from './dashboard-build/generate';
import { errorRootCauseScenario } from './error-root-cause/generate';
import { latencySpikeScenario } from './latency-spike/generate';
import { noisySignalsScenario } from './noisy-signals/generate';
import { segmentedRegressionScenario } from './segmented-regression/generate';
import { serviceHealthCheckScenario } from './service-health-check/generate';
import type { Scenario } from './types';

export const SCENARIOS: Record<string, Scenario> = {
  [dashboardBuildScenario.name]: dashboardBuildScenario,
  [errorRootCauseScenario.name]: errorRootCauseScenario,
  [latencySpikeScenario.name]: latencySpikeScenario,
  [noisySignalsScenario.name]: noisySignalsScenario,
  [segmentedRegressionScenario.name]: segmentedRegressionScenario,
  [serviceHealthCheckScenario.name]: serviceHealthCheckScenario,
};

export const SCENARIO_NAMES = Object.keys(SCENARIOS);

export function getScenario(name: string): Scenario {
  const s = SCENARIOS[name];
  if (!s) {
    throw new Error(
      `Unknown scenario: ${name}. Known: ${SCENARIO_NAMES.join(', ')}`,
    );
  }
  return s;
}
