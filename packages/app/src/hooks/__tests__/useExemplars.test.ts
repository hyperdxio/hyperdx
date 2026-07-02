import { normalizePrometheusExemplars } from '@/hooks/useExemplars';

describe('normalizePrometheusExemplars', () => {
  it('returns [] for undefined/empty input', () => {
    expect(normalizePrometheusExemplars(undefined)).toEqual([]);
    expect(normalizePrometheusExemplars([])).toEqual([]);
  });

  it('maps trace/span ids, value, and seconds→ms timestamp', () => {
    const result = normalizePrometheusExemplars([
      {
        seriesLabels: { __name__: 'http_latency', service: 'api' },
        exemplars: [
          {
            labels: { trace_id: 'abc', span_id: 'def' },
            value: '1.5',
            timestamp: 1700000000,
          },
        ],
      },
    ]);
    expect(result).toEqual([
      {
        timestamp: 1700000000 * 1000,
        value: 1.5,
        traceId: 'abc',
        spanId: 'def',
        groupKey: 'service="api"',
      },
    ]);
  });

  it('accepts alternate label spellings (traceID/spanID)', () => {
    const [ex] = normalizePrometheusExemplars([
      {
        seriesLabels: {},
        exemplars: [
          {
            labels: { traceID: 'xyz', spanID: 's1' },
            value: '2',
            timestamp: 1,
          },
        ],
      },
    ]);
    expect(ex.traceId).toBe('xyz');
    expect(ex.spanId).toBe('s1');
    expect(ex.groupKey).toBeUndefined();
  });

  it('skips exemplars without a trace id', () => {
    expect(
      normalizePrometheusExemplars([
        {
          seriesLabels: {},
          exemplars: [{ labels: { foo: 'bar' }, value: '1', timestamp: 1 }],
        },
      ]),
    ).toEqual([]);
  });
});
