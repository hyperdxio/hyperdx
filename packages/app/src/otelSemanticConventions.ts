/**
 * OpenTelemetry Semantic Conventions utilities
 * Handles transformations between different versions of OTel semantic conventions
 */
import SqlString from 'sqlstring';

/**
 * Mapping of old metric names to new metric names based on semantic convention version
 * The key is the old metric name for easy lookup
 */
const METRIC_NAME_MIGRATIONS: Record<
  string,
  {
    newName: string;
    versionThreshold: string;
  }
> = {
  'k8s.pod.cpu.utilization': {
    newName: 'k8s.pod.cpu.usage',
    versionThreshold: '0.125.0',
  },
  'k8s.node.cpu.utilization': {
    newName: 'k8s.node.cpu.usage',
    versionThreshold: '0.125.0',
  },
  'container.cpu.utilization': {
    newName: 'container.cpu.usage',
    versionThreshold: '0.125.0',
  },
};

/**
 * Generates SQL expression to coerce metric name to handle both old and new conventions
 * Matches metrics using either the old or new naming convention
 * @param metricName - The metric name to check for migrations (should be the old name)
 * @returns SQL expression if migration exists, undefined otherwise
 */
export function getMetricNameSql(metricName: string): string | undefined {
  const migration = METRIC_NAME_MIGRATIONS[metricName];

  if (!migration) {
    return undefined;
  }

  return SqlString.format('MetricName IN (?)', [
    [metricName, migration.newName],
  ]);
}
