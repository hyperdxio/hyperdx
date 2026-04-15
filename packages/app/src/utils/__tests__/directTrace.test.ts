import {
  buildDirectTraceWhereClause,
  buildTraceRedirectUrl,
  getDefaultDirectTraceDateRange,
} from '../directTrace';

describe('buildDirectTraceWhereClause', () => {
  it('uses the provided trace id expression', () => {
    expect(buildDirectTraceWhereClause('TraceId', 'abc123')).toBe(
      "TraceId = 'abc123'",
    );
  });

  it('escapes quotes in trace ids', () => {
    expect(buildDirectTraceWhereClause('TraceId', "abc'123")).toBe(
      "TraceId = 'abc\\'123'",
    );
  });
});

describe('buildTraceRedirectUrl', () => {
  it('maps a trace path to a search url', () => {
    expect(buildTraceRedirectUrl({ traceId: 'trace-123', search: '' })).toBe(
      '/search?traceId=trace-123',
    );
  });

  it('preserves optional source and time range query params', () => {
    expect(
      buildTraceRedirectUrl({
        traceId: 'trace-123',
        search: '?source=trace-source&from=1&to=2',
      }),
    ).toBe('/search?source=trace-source&from=1&to=2&traceId=trace-123');
  });
});

describe('getDefaultDirectTraceDateRange', () => {
  it('returns a range ending at the current runtime time', () => {
    expect(getDefaultDirectTraceDateRange(1_000_000)).toEqual([
      new Date(1_000_000 - 14 * 24 * 60 * 60 * 1000),
      new Date(1_000_000),
    ]);
  });
});
