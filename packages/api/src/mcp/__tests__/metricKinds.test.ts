import { sanitizeMetricTables } from '../tools/sources/metricKinds';

describe('sanitizeMetricTables', () => {
  it('returns undefined for null / undefined input', () => {
    expect(sanitizeMetricTables(undefined)).toBeUndefined();
    expect(sanitizeMetricTables(null)).toBeUndefined();
  });

  it('preserves valid queryable kind entries', () => {
    expect(
      sanitizeMetricTables({
        gauge: 'otel_metrics_gauge',
        sum: 'otel_metrics_sum',
        histogram: 'otel_metrics_histogram',
      }),
    ).toEqual({
      gauge: 'otel_metrics_gauge',
      sum: 'otel_metrics_sum',
      histogram: 'otel_metrics_histogram',
    });
  });

  it('preserves non-queryable kinds the schema still declares', () => {
    // summary and "exponential histogram" are valid MetricsDataType
    // members even though the query renderer cannot translate them.
    expect(
      sanitizeMetricTables({
        gauge: 'otel_metrics_gauge',
        summary: 'otel_metrics_summary',
        'exponential histogram': 'otel_metrics_exponential_histogram',
      }),
    ).toEqual({
      gauge: 'otel_metrics_gauge',
      summary: 'otel_metrics_summary',
      'exponential histogram': 'otel_metrics_exponential_histogram',
    });
  });

  it('strips Mongoose _id leaking from the metricTables subdoc', () => {
    // Existing documents persisted before the schema fix may still
    // carry a stray ObjectId in the embedded metricTables subdoc.
    // The sanitizer keeps only valid kind keys.
    const result = sanitizeMetricTables({
      gauge: 'otel_metrics_gauge',
      sum: 'otel_metrics_sum',
      _id: '6a2ad3b4da94be764e2deed8',
    });
    expect(result).toEqual({
      gauge: 'otel_metrics_gauge',
      sum: 'otel_metrics_sum',
    });
    expect(result).not.toHaveProperty('_id');
  });

  it('drops unknown keys', () => {
    expect(
      sanitizeMetricTables({
        gauge: 'otel_metrics_gauge',
        not_a_real_kind: 'something',
      }),
    ).toEqual({
      gauge: 'otel_metrics_gauge',
    });
  });

  it('drops non-string values for valid keys', () => {
    expect(
      sanitizeMetricTables({
        gauge: 'otel_metrics_gauge',
        sum: 12345,
        histogram: null,
      } as Record<string, unknown>),
    ).toEqual({
      gauge: 'otel_metrics_gauge',
    });
  });

  it('returns undefined when no valid entries remain', () => {
    expect(
      sanitizeMetricTables({
        _id: 'whatever',
        not_a_real_kind: 'x',
      }),
    ).toBeUndefined();
  });
});
