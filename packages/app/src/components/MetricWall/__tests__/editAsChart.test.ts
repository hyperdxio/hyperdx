import { MetricsDataType } from '@hyperdx/common-utils/dist/types';

import { classifyMetric } from '@/components/MetricWall/classifyMetric';
import { aggConfigFromWall } from '@/components/MetricWall/editAsChart';
import { resolveTileAgg } from '@/components/MetricWall/tileDefaults';

describe('aggConfigFromWall', () => {
  it('carries the tile aggregation, scope and split into one series', () => {
    const name = 'http.server.request.duration';
    const type = MetricsDataType.Histogram;

    const { series, groupBy } = aggConfigFromWall({
      metric: {
        id: `${type}:${name}`,
        name,
        type,
        unit: 'ms',
        classification: classifyMetric({ name, type, unit: 'ms' }),
        keys: new Set(),
        entities: [],
      },
      agg: resolveTileAgg(type, 'p99'),
      filters: [{ key: 'service.name', value: 'api' }],
      splitBy: 'k8s.pod.name',
    });

    expect(series).toEqual([
      expect.objectContaining({
        aggFn: 'quantile',
        level: 0.99,
        metricName: name,
        metricType: type,
        valueExpression: 'Value',
        aggCondition: expect.stringContaining(
          "ResourceAttributes['service.name'] = 'api'",
        ),
      }),
    ]);
    expect(groupBy).toContain("ResourceAttributes['k8s.pod.name']");
  });
});
