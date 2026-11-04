import { MetricsDataType, SourceKind } from '@hyperdx/common-utils/dist/types';

import { getExemplarToggleState } from '@/components/Exemplars';

const metricChart = {
  enabled: true,
  configType: 'builder' as const,
  sourceKind: SourceKind.Metric,
  series: [{ aggFn: 'quantile', metricType: MetricsDataType.Histogram }],
};

describe('getExemplarToggleState', () => {
  it('hides the toggle while the deployment flag is off', () => {
    expect(getExemplarToggleState({ ...metricChart, enabled: false })).toEqual({
      showExemplars: false,
    });
  });

  it('hides the toggle on raw SQL and on sources that carry no exemplars', () => {
    expect(
      getExemplarToggleState({ ...metricChart, configType: 'sql' }),
    ).toEqual({ showExemplars: false });
    expect(
      getExemplarToggleState({ ...metricChart, sourceKind: SourceKind.Log }),
    ).toEqual({ showExemplars: false });
  });

  it('offers the toggle on a single quantile-aggregated histogram series', () => {
    expect(getExemplarToggleState(metricChart)).toEqual({
      showExemplars: true,
      exemplarIneligibleReason: undefined,
    });
  });

  it.each([
    [
      'a second series',
      {
        series: [
          { aggFn: 'quantile', metricType: MetricsDataType.Histogram },
          { aggFn: 'quantile', metricType: MetricsDataType.Histogram },
        ],
      },
    ],
    ['a group by', { groupBy: ['ServiceName'] }],
    ['a ratio', { seriesReturnType: 'ratio' as const }],
    [
      'a gauge',
      { series: [{ aggFn: 'avg', metricType: MetricsDataType.Gauge }] },
    ],
    [
      'a count aggregation',
      {
        series: [{ aggFn: 'count', metricType: MetricsDataType.Histogram }],
      },
    ],
  ])('shows the toggle but refuses %s', (_label, override) => {
    const state = getExemplarToggleState({ ...metricChart, ...override });
    expect(state.showExemplars).toBe(true);
    expect(state.exemplarIneligibleReason).toMatch(
      /single non-ratio histogram series/,
    );
  });

  it('accepts a PromQL expression whose whole value is a duration', () => {
    expect(
      getExemplarToggleState({
        enabled: true,
        configType: 'promql',
        promqlExpression: 'histogram_quantile(0.95, http_latency)',
      }),
    ).toEqual({ showExemplars: true, exemplarIneligibleReason: undefined });
  });

  it.each([
    ['a rate over buckets', 'rate(http_latency_bucket[5m])'],
    ['a rescaled quantile', 'histogram_quantile(0.95, http_latency) * 1000'],
    ['no expression yet', undefined],
  ])('shows the toggle but refuses PromQL with %s', (_label, expression) => {
    const state = getExemplarToggleState({
      enabled: true,
      configType: 'promql',
      promqlExpression: expression,
    });
    expect(state.showExemplars).toBe(true);
    expect(state.exemplarIneligibleReason).toMatch(/plots a duration/);
  });
});
