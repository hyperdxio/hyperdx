import { MetricsDataType } from '@hyperdx/common-utils/dist/types';

import {
  formatMetricQuery,
  matchesMetricQuery,
  parseMetricQuery,
  toggleMetricQueryToken,
} from '@/components/MetricWall/parseMetricQuery';

describe('parseMetricQuery', () => {
  it('splits filters from free text', () => {
    expect(
      parseMetricQuery('unit:ms has:http.route service.name=api request'),
    ).toEqual({
      text: 'request',
      tokens: [
        { type: 'unit', value: 'ms' },
        { type: 'has', key: 'http.route' },
        { type: 'attr', key: 'service.name', value: 'api' },
      ],
    });
  });

  it('reads quoted values and ignores unknown facets as text', () => {
    expect(
      parseMetricQuery('env="prod eu" quantity:latency kind:nope'),
    ).toEqual({
      text: 'kind:nope',
      tokens: [
        { type: 'attr', key: 'env', value: 'prod eu' },
        { type: 'quantity', value: 'latency' },
      ],
    });
  });

  it('round-trips through formatMetricQuery', () => {
    const query = 'unit:ms env="prod eu" request';
    expect(formatMetricQuery(parseMetricQuery(query))).toBe(query);
  });

  it('toggles a facet on and off', () => {
    const on = toggleMetricQueryToken('duration', {
      type: 'quantity',
      value: 'latency',
    });
    expect(on).toBe('quantity:latency duration');
    expect(
      toggleMetricQueryToken(on, { type: 'quantity', value: 'latency' }),
    ).toBe('duration');
  });
});

describe('matchesMetricQuery', () => {
  const metric = {
    name: 'http.server.request.duration',
    type: MetricsDataType.Histogram,
    unit: 'ms',
    description: 'Duration of HTTP server requests',
    quantity: 'latency' as const,
    hasKey: (key: string) => key === 'http.route',
  };

  it.each([
    ['server', true],
    ['HTTP SERVER requests', true],
    ['server duration', false],
    ['unit:ms', true],
    ['unit:s', false],
    ['has:http.route', true],
    ['http.route=/cart', true],
    ['k8s.pod.name=a', false],
    ['quantity:latency kind:histogram', true],
    ['kind:gauge', false],
  ])('%s matches: %s', (query, expected) => {
    expect(matchesMetricQuery(metric, parseMetricQuery(query))).toBe(expected);
  });
});
