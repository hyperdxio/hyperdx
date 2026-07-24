import { dashboardBuildScenario } from './dashboard-build/generate';
import { deployRegressionScenario } from './deploy-regression/generate';
import { errorRootCauseScenario } from './error-root-cause/generate';
import { latencySpikeScenario } from './latency-spike/generate';
import { metricSaturationScenario } from './metric-saturation/generate';
import { noisySignalsScenario } from './noisy-signals/generate';
import { segmentedRegressionScenario } from './segmented-regression/generate';
import { serviceHealthCheckScenario } from './service-health-check/generate';
import type { Scenario } from './types';

export const SCENARIOS: Record<string, Scenario> = {
  [dashboardBuildScenario.name]: dashboardBuildScenario,
  [deployRegressionScenario.name]: deployRegressionScenario,
  [errorRootCauseScenario.name]: errorRootCauseScenario,
  [latencySpikeScenario.name]: latencySpikeScenario,
  [metricSaturationScenario.name]: metricSaturationScenario,
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
