import { MetricsDataType } from '@hyperdx/common-utils/dist/types';

import { matchMetricTables } from '@/utils/metricTableAutofill';

const empty: Partial<Record<MetricsDataType, string>> = {};

describe('matchMetricTables', () => {
  it('returns empty when no tables match', () => {
    expect(matchMetricTables(['events', 'users', 'logs'], empty)).toEqual({});
  });

  it('returns empty for an empty table list', () => {
    expect(matchMetricTables([], empty)).toEqual({});
  });

  // --- basic suffix matching ---

  it('matches standard otel_metrics_ prefixed tables', () => {
    const tables = [
      'otel_metrics_gauge',
      'otel_metrics_histogram',
      'otel_metrics_sum',
      'otel_metrics_summary',
      'otel_metrics_exp_histogram',
    ];
    expect(matchMetricTables(tables, empty)).toEqual({
      [MetricsDataType.Gauge]: 'otel_metrics_gauge',
      [MetricsDataType.Histogram]: 'otel_metrics_histogram',
      [MetricsDataType.Sum]: 'otel_metrics_sum',
      [MetricsDataType.Summary]: 'otel_metrics_summary',
      [MetricsDataType.ExponentialHistogram]: 'otel_metrics_exp_histogram',
    });
  });

  it('matches hyphen-separated suffixes', () => {
    const tables = [
      'app-gauge',
      'app-histogram',
      'app-sum',
      'app-summary',
      'app-exp-histogram',
    ];
    expect(matchMetricTables(tables, empty)).toEqual({
      [MetricsDataType.Gauge]: 'app-gauge',
      [MetricsDataType.Histogram]: 'app-histogram',
      [MetricsDataType.Sum]: 'app-sum',
      [MetricsDataType.Summary]: 'app-summary',
      [MetricsDataType.ExponentialHistogram]: 'app-exp-histogram',
    });
  });

  it('matches _exponential_histogram and -exponential-histogram suffixes', () => {
    expect(
      matchMetricTables(['my_exponential_histogram'], empty),
    ).toMatchObject({
      [MetricsDataType.ExponentialHistogram]: 'my_exponential_histogram',
    });

    expect(
      matchMetricTables(['my-exponential-histogram'], empty),
    ).toMatchObject({
      [MetricsDataType.ExponentialHistogram]: 'my-exponential-histogram',
    });
  });

  // --- exclusion rules ---

  it('does not match _summary tables as sum', () => {
    const result = matchMetricTables(['metrics_summary'], empty);
    expect(result[MetricsDataType.Sum]).toBeUndefined();
    expect(result[MetricsDataType.Summary]).toBe('metrics_summary');
  });

  it('does not match _exp_histogram tables as histogram', () => {
    const result = matchMetricTables(['metrics_exp_histogram'], empty);
    expect(result[MetricsDataType.Histogram]).toBeUndefined();
    expect(result[MetricsDataType.ExponentialHistogram]).toBe(
      'metrics_exp_histogram',
    );
  });

  it('does not match -exp-histogram tables as histogram', () => {
    const result = matchMetricTables(['metrics-exp-histogram'], empty);
    expect(result[MetricsDataType.Histogram]).toBeUndefined();
    expect(result[MetricsDataType.ExponentialHistogram]).toBe(
      'metrics-exp-histogram',
    );
  });

  it('does not match _exponential_histogram tables as histogram', () => {
    const result = matchMetricTables(['my_exponential_histogram'], empty);
    expect(result[MetricsDataType.Histogram]).toBeUndefined();
  });

  it('does not match -summary tables as sum', () => {
    const result = matchMetricTables(['app-summary'], empty);
    expect(result[MetricsDataType.Sum]).toBeUndefined();
    expect(result[MetricsDataType.Summary]).toBe('app-summary');
  });

  // --- priority: otel_metrics_ prefix first, then shortest ---

  it('prefers otel_metrics_ prefixed table over custom name', () => {
    const tables = ['custom_gauge', 'otel_metrics_gauge'];
    const result = matchMetricTables(tables, empty);
    expect(result[MetricsDataType.Gauge]).toBe('otel_metrics_gauge');
  });

  it('prefers shorter name when no otel_metrics_ prefix', () => {
    const tables = ['long_prefix_app_gauge', 'app_gauge'];
    const result = matchMetricTables(tables, empty);
    expect(result[MetricsDataType.Gauge]).toBe('app_gauge');
  });

  // --- guard rails: never overwrite user selections ---

  it('skips fields that already have a value', () => {
    const tables = ['otel_metrics_gauge', 'otel_metrics_histogram'];
    const current = { [MetricsDataType.Gauge]: 'user_picked_table' };
    const result = matchMetricTables(tables, current);

    expect(result[MetricsDataType.Gauge]).toBeUndefined();
    expect(result[MetricsDataType.Histogram]).toBe('otel_metrics_histogram');
  });

  it('returns empty when all fields are already filled', () => {
    const tables = [
      'otel_metrics_gauge',
      'otel_metrics_histogram',
      'otel_metrics_sum',
      'otel_metrics_summary',
      'otel_metrics_exp_histogram',
    ];
    const current: Record<MetricsDataType, string> = {
      [MetricsDataType.Gauge]: 'a',
      [MetricsDataType.Histogram]: 'b',
      [MetricsDataType.Sum]: 'c',
      [MetricsDataType.Summary]: 'd',
      [MetricsDataType.ExponentialHistogram]: 'e',
    };
    expect(matchMetricTables(tables, current)).toEqual({});
  });

  // --- case insensitivity ---

  it('matches case-insensitively', () => {
    const tables = ['MyApp_Gauge', 'DATA_HISTOGRAM'];
    const result = matchMetricTables(tables, empty);
    expect(result[MetricsDataType.Gauge]).toBe('MyApp_Gauge');
    expect(result[MetricsDataType.Histogram]).toBe('DATA_HISTOGRAM');
  });

  // --- mixed scenario ---

  it('handles a realistic mixed database with partial matches', () => {
    const tables = [
      'events',
      'otel_metrics_gauge',
      'otel_metrics_histogram',
      'otel_metrics_exp_histogram',
      'otel_metrics_sum',
      'otel_metrics_summary',
      'otel_logs',
      'otel_traces',
    ];
    expect(matchMetricTables(tables, empty)).toEqual({
      [MetricsDataType.Gauge]: 'otel_metrics_gauge',
      [MetricsDataType.Histogram]: 'otel_metrics_histogram',
      [MetricsDataType.Sum]: 'otel_metrics_sum',
      [MetricsDataType.Summary]: 'otel_metrics_summary',
      [MetricsDataType.ExponentialHistogram]: 'otel_metrics_exp_histogram',
    });
  });
});
