import {
  formatMatrixResponse,
  formatVectorResponse,
  parseDuration,
  parseTimestamp,
  resolveExemplarWindow,
} from '@/routers/api/prometheus';

describe('parseTimestamp', () => {
  it('returns numeric inputs unchanged', () => {
    expect(parseTimestamp(1700000000)).toBe(1700000000);
    expect(parseTimestamp(1700000000.5)).toBe(1700000000.5);
  });

  it('parses numeric strings as unix seconds', () => {
    expect(parseTimestamp('1700000000')).toBe(1700000000);
    expect(parseTimestamp('1700000000.5')).toBe(1700000000.5);
  });

  it('parses RFC3339 strings to unix seconds', () => {
    expect(parseTimestamp('2023-11-14T22:13:20.000Z')).toBe(1700000000);
  });

  it('throws on unparseable input', () => {
    expect(() => parseTimestamp('not-a-date')).toThrow(/Invalid timestamp/);
  });
});

describe('parseDuration', () => {
  it('returns numeric inputs unchanged', () => {
    expect(parseDuration(60)).toBe(60);
  });

  it('parses bare numeric strings as seconds', () => {
    expect(parseDuration('60')).toBe(60);
  });

  it.each([
    ['500ms', 0.5],
    ['30s', 30],
    ['5m', 300],
    ['2h', 7200],
    ['1d', 86400],
    ['1w', 604800],
    ['1y', 31536000],
  ])('parses %s to %d seconds', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it('parses fractional durations', () => {
    expect(parseDuration('1.5h')).toBe(5400);
  });

  it('throws on invalid units', () => {
    expect(() => parseDuration('5x')).toThrow(/Invalid duration/);
  });

  it('throws on garbage input', () => {
    expect(() => parseDuration('abc')).toThrow(/Invalid duration/);
  });
});

describe('formatMatrixResponse', () => {
  it('converts ClickHouse rows into Prometheus matrix shape', () => {
    const rows = [
      {
        tags: [
          ['__name__', 'http_requests_total'],
          ['method', 'GET'],
        ] as [string, string][],
        time_series: [
          [1700000000, 5],
          [1700000060, 7],
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

  it('converts string timestamps to unix seconds', () => {
    const rows = [
      {
        tags: [] as [string, string][],
        time_series: [['2023-11-14T22:13:20.000Z', 1]] as [
          string | number,
          number,
        ][],
      },
    ];
    expect(formatMatrixResponse(rows as any)[0].values[0]).toEqual([
      1700000000,
      '1',
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(formatMatrixResponse([])).toEqual([]);
  });
});

describe('formatVectorResponse', () => {
  it('converts ClickHouse rows into Prometheus vector shape', () => {
    const rows = [
      {
        tags: [['service', 'api']] as [string, string][],
        timestamp: 1700000000 as unknown as string,
        value: 42,
      },
    ];
    expect(formatVectorResponse(rows as any)).toEqual([
      { metric: { service: 'api' }, value: [1700000000, '42'] },
    ]);
  });

  it('converts string timestamps to unix seconds', () => {
    const rows = [
      {
        tags: [] as [string, string][],
        timestamp: '2023-11-14T22:13:20.000Z',
        value: 3,
      },
    ];
    expect(formatVectorResponse(rows as any)[0].value).toEqual([
      1700000000,
      '3',
    ]);
  });
});

describe('resolveExemplarWindow', () => {
  const DAY = 24 * 60 * 60;
  const end = 1_700_000_000;

  it('passes a window inside the cap through untouched', () => {
    expect(resolveExemplarWindow(String(end - DAY), String(end))).toEqual({
      start: end - DAY,
      end,
    });
  });

  it('narrows an over-wide window instead of rejecting it', () => {
    // A 30-day dashboard range is an ordinary request, and Prometheus keeps
    // exemplars in a small recent buffer, so the older part has nothing to
    // return. Rejecting would surface as the chart's exemplar error indicator on
    // a perfectly healthy chart.
    const result = resolveExemplarWindow(String(end - 30 * DAY), String(end));
    expect(result).toEqual({ start: end - 7 * DAY, end });
  });

  it('keeps the requested end when narrowing', () => {
    const result = resolveExemplarWindow(String(end - 30 * DAY), String(end));
    expect('end' in result && result.end).toBe(end);
  });

  it('rejects an inverted range', () => {
    expect(resolveExemplarWindow(String(end), String(end - DAY))).toEqual({
      error: 'invalid or missing start/end parameters',
    });
  });

  it('rejects a missing or unparseable bound', () => {
    for (const [start, endArg] of [
      [undefined, String(end)],
      [String(end - DAY), undefined],
      ['', String(end)],
      ['not-a-time', String(end)],
    ] as [string | undefined, string | undefined][]) {
      expect(resolveExemplarWindow(start, endArg)).toEqual({
        error: 'invalid or missing start/end parameters',
      });
    }
  });

  it('accepts an ISO timestamp, matching parseTimestamp', () => {
    const result = resolveExemplarWindow(
      '2023-11-14T22:13:20Z',
      '2023-11-14T22:14:20Z',
    );
    expect('start' in result).toBe(true);
  });

  it('honours an explicit cap', () => {
    expect(resolveExemplarWindow(String(end - 100), String(end), 10)).toEqual({
      start: end - 10,
      end,
    });
  });
});
