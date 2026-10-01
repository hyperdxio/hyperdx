import {
  formatMatrixResponse,
  formatVectorResponse,
} from '@/controllers/timeseriesEngine';

describe('formatMatrixResponse', () => {
  it('converts prometheusQueryRange rows into Prometheus matrix shape', () => {
    const rows = [
      {
        tags: [
          ['__name__', 'http_requests_total'],
          ['method', 'GET'],
        ] as [string, string][],
        samples: [
          [1700000000, 5],
          ['2023-11-14T22:14:20.000Z', 7],
        ] as [string | number, number][],
      },
    ];
    expect(formatMatrixResponse(rows as any)).toEqual([
      {
        metric: { __name__: 'http_requests_total', method: 'GET' },
        values: [
          [1700000000, '5'],
          [1700000060, '7'],
        ],
      },
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(formatMatrixResponse([])).toEqual([]);
  });
});

describe('formatVectorResponse', () => {
  it('converts prometheusQuery rows into Prometheus vector shape', () => {
    const rows = [
      { tags: [['service', 'api']], timestamp: 1700000000, value: 42 },
      { tags: [], timestamp: '2023-11-14T22:13:20.000Z', value: 3 },
    ];
    expect(formatVectorResponse(rows as any)).toEqual([
      { metric: { service: 'api' }, value: [1700000000, '42'] },
      { metric: {}, value: [1700000000, '3'] },
    ]);
  });
});
