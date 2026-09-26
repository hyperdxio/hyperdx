import { MetricsDataType } from '@hyperdx/common-utils/dist/types';

import { classifyMetric } from '@/components/MetricWall/classifyMetric';
import { parseMetricQuery } from '@/components/MetricWall/parseMetricQuery';
import {
  WallMetric,
  wallMetricId,
} from '@/components/MetricWall/useMetricWallCatalog';
import { groupWallMetrics } from '@/components/MetricWall/wallGrouping';

function metric(
  name: string,
  type: MetricsDataType,
  unit: string | undefined,
  entities: string[],
  keys: string[] = [],
): WallMetric {
  return {
    id: wallMetricId(type, name),
    name,
    type,
    unit,
    classification: classifyMetric({ name, type, unit }),
    keys: new Set(keys),
    entities: entities.map(e => {
      const [key, value] = e.split('=');
      return { key, value };
    }),
  };
}

const metrics = [
  metric(
    'http.server.request.duration',
    MetricsDataType.Histogram,
    'ms',
    ['service.name=api', 'service.name=web'],
    ['http.route'],
  ),
  metric('http.server.error.count', MetricsDataType.Sum, '1', [
    'service.name=api',
  ]),
  metric('node_load1', MetricsDataType.Gauge, '1', ['host.name=ip-10']),
  metric('orders_processed', MetricsDataType.Sum, undefined, []),
];

describe('groupWallMetrics', () => {
  it('groups by entity, busiest first, then bands by quantity', () => {
    const sections = groupWallMetrics(metrics, parseMetricQuery(''), 'entity');

    expect(sections.map(s => s.id)).toEqual([
      'service.name=api',
      'host.name=ip-10',
      'service.name=web',
      'unscoped',
    ]);
    expect(sections[0].bands.map(b => b.quantity)).toEqual([
      'latency',
      'errors',
    ]);
    expect(sections[3].bands[0].quantity).toBe('unclassified');
  });

  it('lets an entity filter pick the sections', () => {
    const sections = groupWallMetrics(
      metrics,
      parseMetricQuery('service.name=web'),
      'entity',
    );

    expect(sections.map(s => s.id)).toEqual(['service.name=web']);
  });

  it('narrows by attribute key and quantity', () => {
    const sections = groupWallMetrics(
      metrics,
      parseMetricQuery('has:http.route quantity:latency'),
      'quantity',
    );

    expect(sections).toHaveLength(1);
    expect(sections[0].bands[0].items.map(i => i.metric.name)).toEqual([
      'http.server.request.duration',
    ]);
  });

  it('lists everything in one band when flat', () => {
    const [section] = groupWallMetrics(metrics, parseMetricQuery(''), 'flat');

    expect(section.bands).toHaveLength(1);
    expect(section.metricCount).toBe(4);
  });
});
