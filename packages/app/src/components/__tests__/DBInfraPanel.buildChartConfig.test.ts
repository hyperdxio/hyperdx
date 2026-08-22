import { Granularity } from '@hyperdx/common-utils/dist/core/utils';
import {
  DisplayType,
  MetricsDataType,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';

import { buildChartConfig } from '@/components/DBInfraPanel';
import { INFRA_CORRELATIONS } from '@/components/infraCorrelations';

jest.mock('@/components/DBTimeChart', () => ({ DBTimeChart: () => null }));
jest.mock('@/components/Sources/SourceForm', () => ({
  TableSourceForm: () => null,
}));
jest.mock('@/components/KubeComponents', () => ({ KubeTimeline: () => null }));

const METRIC_SOURCE = {
  id: 'metric-source-1',
  kind: 'metric',
  name: 'Metrics',
  connection: 'conn-1',
  from: { databaseName: 'default', tableName: '' },
  timestampValueExpression: 'TimeUnix',
  resourceAttributesExpression: 'ResourceAttributes',
  metricTables: {
    gauge: 'otel_metrics_gauge',
    sum: 'otel_metrics_sum',
    histogram: 'otel_metrics_histogram',
    summary: 'otel_metrics_summary',
    'exponential histogram': 'otel_metrics_exponential_histogram',
  },
} as unknown as TMetricSource;

const DATE_RANGE: [Date, Date] = [
  new Date('2026-01-01T00:00:00Z'),
  new Date('2026-01-01T01:00:00Z'),
];

const gpu = INFRA_CORRELATIONS.find(c => c.title === 'GPU')!;
const node = INFRA_CORRELATIONS.find(c => c.title === 'Node')!;

function build(correlation: typeof gpu, cardTestId: string, where: string) {
  const chart = correlation.charts.find(c => c.cardTestId === cardTestId)!;
  return buildChartConfig({
    chart,
    fieldPrefix: correlation.fieldPrefix,
    where,
    metricSource: METRIC_SOURCE,
    dateRange: DATE_RANGE,
    granularity: Granularity.OneMinute,
  });
}

describe('buildChartConfig', () => {
  const where = 'ResourceAttributes.k8s.node.name:"gpu-node-1"';

  it('builds a gauge metric select with the fully-qualified metric name', () => {
    const config = build(gpu, 'gpu-memory-utilization-card', where);
    expect(config.select).toEqual([
      {
        aggFn: 'avg',
        metricType: MetricsDataType.Gauge,
        metricName: 'hw.gpu.memory.utilization',
        metricNameSql: undefined,
        valueExpression: 'Value',
        aggConditionLanguage: 'lucene',
        aggCondition: where,
      },
    ]);
  });

  it('uses the correlation filter verbatim as the agg condition', () => {
    const config = build(gpu, 'gpu-utilization-card', where);
    expect(Array.isArray(config.select) && config.select[0].aggCondition).toBe(
      where,
    );
  });

  it('joins multiple GPU groupBy expressions into raw SQL', () => {
    const config = build(gpu, 'gpu-utilization-card', where);
    expect(config.groupBy).toContain("Attributes['hw.id']");
    expect(config.groupBy).toContain("Attributes['hw.gpu.task']");
    // Comma-joined so ClickHouse sees two group columns, which DBTimeChart
    // renders as "<device> · <task>".
    expect(config.groupBy).toBe(
      gpu.charts
        .find(c => c.cardTestId === 'gpu-utilization-card')!
        .groupBy!.join(', '),
    );
  });

  it('leaves groupBy empty for charts that do not define one', () => {
    const config = build(node, 'cpu-usage-card', where);
    expect(config.groupBy).toBe('');
  });

  it('threads source wiring and render settings onto the config', () => {
    const config = build(gpu, 'gpu-utilization-card', where);
    expect(config).toMatchObject({
      displayType: DisplayType.Line,
      from: METRIC_SOURCE.from,
      where: '',
      whereLanguage: 'lucene',
      metricTables: METRIC_SOURCE.metricTables,
      timestampValueExpression: 'TimeUnix',
      connection: 'conn-1',
      granularity: Granularity.OneMinute,
      dateRange: DATE_RANGE,
    });
    expect(config.numberFormat).toMatchObject({ output: 'percent' });
  });

  it('emits the semconv rename matcher for migrated k8s CPU metrics', () => {
    const config = build(node, 'cpu-usage-card', where);
    // k8s.node.cpu.utilization was renamed to k8s.node.cpu.usage; both must
    // match or the Node CPU chart silently empties on newer collectors.
    expect(Array.isArray(config.select) && config.select[0].metricNameSql).toBe(
      "MetricName IN ('k8s.node.cpu.utilization', 'k8s.node.cpu.usage')",
    );
  });

  it('leaves metricNameSql undefined for metrics with no rename', () => {
    const config = build(node, 'memory-usage-card', where);
    expect(
      Array.isArray(config.select) && config.select[0].metricNameSql,
    ).toBeUndefined();
  });
});
