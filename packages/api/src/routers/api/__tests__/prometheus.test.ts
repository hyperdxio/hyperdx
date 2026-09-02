const mockCounterAdd = jest.fn();

jest.mock('@/utils/instrumentation', () => {
  const actual = jest.requireActual('@/utils/instrumentation');
  return {
    ...actual,
    getCounter: () => ({ add: mockCounterAdd }),
  };
});

import {
  formatMatrixResponse,
  formatVectorResponse,
  isClientDisconnect,
  joinPrometheusUpstreamUrl,
  parseDuration,
  parseTimestamp,
  recordProxyOutcome,
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

describe('recordProxyOutcome', () => {
  beforeEach(() => {
    mockCounterAdd.mockClear();
  });

  // proxyToPrometheus handles its own failures by writing a status and returning
  // normally, so the caller's catch never sees an upstream outage — this is the
  // only place the proxy path's error counter moves.
  it.each([500, 502, 503, 504])('counts an upstream %i', status => {
    recordProxyOutcome(status, 'query_exemplars', 'prometheus');
    expect(mockCounterAdd).toHaveBeenCalledWith(1, {
      endpoint: 'query_exemplars',
      backend: 'prometheus',
    });
  });

  // A 4xx is almost always a PromQL expression the user typed. Counting those
  // would make the counter track typos rather than backend health, which is what
  // alerts and SLOs read it for.
  it.each([200, 204, 400, 404, 422])('does not count a %i', status => {
    recordProxyOutcome(status, 'query_range', 'prometheus');
    expect(mockCounterAdd).not.toHaveBeenCalled();
  });
});

describe('isClientDisconnect', () => {
  // `pipeline` destroys the response stream before rejecting no matter which end
  // failed, so `res.destroyed` cannot tell these apart — an earlier revision
  // tested it and silently reclassified every upstream fault as a cancellation,
  // leaving the error counter at zero for truncated bodies.
  it('is false when the upstream stream fails mid-body', () => {
    // What undici raises when the upstream resets: no `code`.
    expect(isClientDisconnect(new TypeError('terminated'))).toBe(false);
  });

  it('is true when the client hangs up mid-body', () => {
    expect(
      isClientDisconnect(
        Object.assign(new Error('Premature close'), {
          code: 'ERR_STREAM_PREMATURE_CLOSE',
        }),
      ),
    ).toBe(true);
  });

  it('is false for a non-Error rejection', () => {
    expect(isClientDisconnect('boom')).toBe(false);
    expect(isClientDisconnect(undefined)).toBe(false);
  });
});

describe('joinPrometheusUpstreamUrl', () => {
  it('keeps a root-mounted Prometheus host working', () => {
    expect(
      joinPrometheusUpstreamUrl(
        'http://prometheus:9090',
        '/api/v1/query_range',
      ).toString(),
    ).toBe('http://prometheus:9090/api/v1/query_range');
  });

  it('keeps a trailing slash on a root-mounted host from doubling the path', () => {
    expect(
      joinPrometheusUpstreamUrl(
        'http://prometheus:9090/',
        '/api/v1/query_range',
      ).toString(),
    ).toBe('http://prometheus:9090/api/v1/query_range');
  });

  it('preserves a VictoriaMetrics cluster tenant prefix', () => {
    expect(
      joinPrometheusUpstreamUrl(
        'http://vmselect:8481/select/0/prometheus',
        '/api/v1/query_range',
      ).toString(),
    ).toBe('http://vmselect:8481/select/0/prometheus/api/v1/query_range');
  });

  it('strips a trailing slash on the tenant prefix before joining', () => {
    expect(
      joinPrometheusUpstreamUrl(
        'http://vmselect:8481/select/0/prometheus/',
        '/api/v1/label/__name__/values',
      ).toString(),
    ).toBe(
      'http://vmselect:8481/select/0/prometheus/api/v1/label/__name__/values',
    );
  });

  it('preserves userinfo and existing query params on the connection host', () => {
    expect(
      joinPrometheusUpstreamUrl(
        'http://user:pw@vmselect:8481/select/0/prometheus?extra=1',
        '/api/v1/query',
      ).toString(),
    ).toBe(
      'http://user:pw@vmselect:8481/select/0/prometheus/api/v1/query?extra=1',
    );
  });

  it('prepends a slash when the path has none', () => {
    expect(
      joinPrometheusUpstreamUrl(
        'http://prometheus:9090',
        'api/v1/query',
      ).toString(),
    ).toBe('http://prometheus:9090/api/v1/query');
  });

  it('throws on an invalid connection host, matching the proxy 400 path', () => {
    expect(() =>
      joinPrometheusUpstreamUrl('not-a-url', '/api/v1/query_range'),
    ).toThrow();
  });

  // `new URL('prometheus:9090')` succeeds (scheme `prometheus:`, opaque path).
  // Without the http(s) guard the helper would return the host unchanged and
  // the proxy would 502 instead of 400.
  it('throws on a scheme-less host that URL parses as an opaque path', () => {
    expect(() =>
      joinPrometheusUpstreamUrl('prometheus:9090', '/api/v1/query_range'),
    ).toThrow(/http\(s\)/);
    expect(() =>
      joinPrometheusUpstreamUrl('localhost:9090', '/api/v1/query_range'),
    ).toThrow(/http\(s\)/);
  });
});
