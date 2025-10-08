/**
 * OpenTelemetry Semantic Conventions utilities
 * Handles transformations between different versions of OTel semantic conventions
 */

/**
 * Mapping of old metric names to new metric names based on semantic convention version
 */
const METRIC_NAME_MIGRATIONS: Record<
  string,
  {
    oldName: string;
    newName: string;
    versionThreshold: string;
  }
> = {
  'k8s.pod.cpu.utilization': {
    oldName: 'k8s.pod.cpu.utilization',
    newName: 'k8s.pod.cpu.usage',
    versionThreshold: '0.125.0',
  },
  'k8s.node.cpu.utilization': {
    oldName: 'k8s.node.cpu.utilization',
    newName: 'k8s.node.cpu.usage',
    versionThreshold: '0.125.0',
  },
  'container.cpu.utilization': {
    oldName: 'container.cpu.utilization',
    newName: 'container.cpu.usage',
    versionThreshold: '0.125.0',
  },
};

/**
 * Generates SQL expression to dynamically select metric name based on ScopeVersion
 * @param metricName - The metric name to check for migrations
 * @returns SQL expression if migration exists, undefined otherwise
 */
export function getMetricNameSql(metricName: string): string | undefined {
  const migration = METRIC_NAME_MIGRATIONS[metricName];

  if (!migration) {
    return undefined;
  }

  return `if(greaterOrEquals(ScopeVersion, '${migration.versionThreshold}'), '${migration.newName}', '${migration.oldName}')`;
}
