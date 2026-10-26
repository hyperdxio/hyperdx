import {
  MetricsDataType,
  MetricSourceSchema,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';

import {
  attributeClauseSql,
  buildTileConfig,
  defaultTileAgg,
  resolveTileAgg,
} from '@/components/MetricWall/tileDefaults';

const source = MetricSourceSchema.parse({
  id: 'src',
  kind: SourceKind.Metric,
  name: 'Metrics',
  connection: 'conn',
  from: { databaseName: 'default', tableName: '' },
  timestampValueExpression: 'TimeUnix',
  resourceAttributesExpression: 'ResourceAttributes',
  metricTables: { gauge: 'otel_metrics_gauge' },
});

describe('tile defaults', () => {
  it.each([
    [MetricsDataType.Gauge, 'avg'],
    [MetricsDataType.Sum, 'increase'],
    [MetricsDataType.Histogram, 'p95'],
    [MetricsDataType.ExponentialHistogram, 'p95'],
  ])('defaults %s to %s', (type, id) => {
    expect(defaultTileAgg(type).id).toBe(id);
  });

  it('falls back to the default for an agg the kind does not offer', () => {
    expect(resolveTileAgg(MetricsDataType.Histogram, 'avg').id).toBe('p95');
    expect(resolveTileAgg(MetricsDataType.Histogram, 'p99').level).toBe(0.99);
  });

  it('matches an attribute on either map, escaping quotes', () => {
    expect(attributeClauseSql({ key: 'service.name', value: "o'k" })).toBe(
      "(ResourceAttributes['service.name'] = 'o''k' OR Attributes['service.name'] = 'o''k')",
    );
  });

  it('builds a metric chart config the renderer understands', () => {
    const config = buildTileConfig({
      source,
      metricName: 'http.server.request.duration',
      metricType: MetricsDataType.Histogram,
      agg: defaultTileAgg(MetricsDataType.Histogram),
      filters: [{ key: 'service.name', value: 'api' }],
      dateRange: [new Date(0), new Date(1000)],
      groupBy: 'k8s.pod.name',
    });

    expect(config.metricTables).toBe(source.metricTables);
    expect(config.select).toEqual([
      expect.objectContaining({
        aggFn: 'quantile',
        level: 0.95,
        valueExpression: 'Value',
        metricName: 'http.server.request.duration',
        metricType: MetricsDataType.Histogram,
      }),
    ]);
    expect(config.where).toContain(
      "ResourceAttributes['service.name'] = 'api'",
    );
    expect(config.groupBy).toContain("ResourceAttributes['k8s.pod.name']");
  });
});
