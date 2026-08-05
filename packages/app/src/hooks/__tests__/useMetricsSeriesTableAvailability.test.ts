import { computeMetricsSeriesTableAvailability } from '@/hooks/useMetricsSeriesTableAvailability';

const BASE = {
  isMetricsSeriesTableEnabled: true,
  seriesTableName: 'otel_metrics_series',
  isLoading: false,
  isSeriesValid: true,
  missingSeriesHashTables: [] as string[],
};

describe('computeMetricsSeriesTableAvailability', () => {
  it('returns disabled when the team flag is off', () => {
    expect(
      computeMetricsSeriesTableAvailability({
        ...BASE,
        isMetricsSeriesTableEnabled: false,
      }),
    ).toEqual({ status: 'disabled', missingSeriesHashTables: [] });
  });

  it('returns not_configured when no series table is set', () => {
    expect(
      computeMetricsSeriesTableAvailability({
        ...BASE,
        seriesTableName: undefined,
      }),
    ).toEqual({ status: 'not_configured', missingSeriesHashTables: [] });
  });

  it('returns loading while column metadata is being fetched', () => {
    expect(
      computeMetricsSeriesTableAvailability({ ...BASE, isLoading: true }),
    ).toEqual({ status: 'loading', missingSeriesHashTables: [] });
  });

  it('returns invalid_series when the series table fails schema validation', () => {
    expect(
      computeMetricsSeriesTableAvailability({ ...BASE, isSeriesValid: false }),
    ).toEqual({ status: 'invalid_series', missingSeriesHashTables: [] });
  });

  it('returns missing_series_hash listing the offending tables', () => {
    expect(
      computeMetricsSeriesTableAvailability({
        ...BASE,
        missingSeriesHashTables: ['otel_metrics_gauge', 'otel_metrics_sum'],
      }),
    ).toEqual({
      status: 'missing_series_hash',
      missingSeriesHashTables: ['otel_metrics_gauge', 'otel_metrics_sum'],
    });
  });

  it('returns ready when everything is configured and valid', () => {
    expect(computeMetricsSeriesTableAvailability(BASE)).toEqual({
      status: 'ready',
      missingSeriesHashTables: [],
    });
  });

  it('returns ready when there are no registered per-type tables (series only)', () => {
    expect(
      computeMetricsSeriesTableAvailability({
        ...BASE,
        missingSeriesHashTables: [],
      }),
    ).toEqual({ status: 'ready', missingSeriesHashTables: [] });
  });

  it('prioritizes disabled over all other conditions', () => {
    expect(
      computeMetricsSeriesTableAvailability({
        isMetricsSeriesTableEnabled: false,
        seriesTableName: undefined,
        isLoading: true,
        isSeriesValid: false,
        missingSeriesHashTables: ['otel_metrics_gauge'],
      }),
    ).toEqual({ status: 'disabled', missingSeriesHashTables: [] });
  });
});
