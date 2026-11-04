import {
  browserSpan,
  logSource,
  PAGE_URL,
  SPAN_START_MS,
} from '@/hooks/__fixtures__/browserTraceEvents';
import {
  getBrowserTraceContext,
  hasSubSecondTimestamps,
  isBrowserEventLogSource,
} from '@/utils/browserTraceContext';

const backendSpan = {
  Timestamp: '2026-10-22T04:52:37.000000000Z',
  Duration: 5,
  ServiceName: 'api',
  SpanAttributes: { 'http.route': '/api/checkout' },
};

describe('getBrowserTraceContext', () => {
  it.each([
    ['no rows', []],
    ['backend spans', [backendSpan]],
    [
      'an AI span with a session id and no page URL',
      [{ ...backendSpan, SpanAttributes: { 'session.id': 's1' } }],
    ],
    [
      'an empty page URL',
      [
        {
          ...browserSpan,
          SpanAttributes: { 'browser.document.url.full': '' },
        },
      ],
    ],
    [
      'an unparsable timestamp',
      [{ ...browserSpan, Timestamp: 'not-a-timestamp' }],
    ],
  ])('is undefined for %s', (_name, rows) => {
    expect(getBrowserTraceContext(rows)).toBeUndefined();
  });

  it('anchors on the earliest browser span, ignoring earlier backend spans', () => {
    const laterSpan = {
      ...browserSpan,
      Timestamp: '2026-10-22T04:52:37.900000000Z',
      Duration: 0.2,
      ServiceName: 'web-worker',
      SpanAttributes: {
        'browser.document.url.full': PAGE_URL,
        'session.id': 's2',
      },
    };
    expect(
      getBrowserTraceContext([laterSpan, backendSpan, browserSpan]),
    ).toEqual({
      serviceNames: ['web', 'web-worker'],
      anchorMs: SPAN_START_MS,
      endMs: Date.parse('2026-10-22T04:52:38.100Z'),
      anchorHidden: false,
      sessionId: 's1',
      serviceName: 'web',
    });
  });

  it('ends at most an hour after the anchor', () => {
    expect(
      getBrowserTraceContext([{ ...browserSpan, Duration: 86400 }])?.endMs,
    ).toBe(SPAN_START_MS + 60 * 60 * 1000);
  });

  it('reads nested JSON attributes', () => {
    const context = getBrowserTraceContext([
      {
        ...browserSpan,
        SpanAttributes: {
          browser: { document: { url: { full: PAGE_URL } } },
          session: { id: 's1' },
        },
      },
    ]);
    expect(context).toMatchObject({
      anchorMs: SPAN_START_MS,
      sessionId: 's1',
    });
  });

  it('dedupes service names and keeps an unset session id unset', () => {
    const context = getBrowserTraceContext([
      {
        ...browserSpan,
        SpanAttributes: { 'browser.document.url.full': PAGE_URL },
      },
      { ...browserSpan, Timestamp: '2026-10-22T04:52:37.830000000Z' },
    ]);
    expect(context).toMatchObject({
      serviceNames: ['web'],
      sessionId: undefined,
      serviceName: 'web',
    });
  });

  it.each([
    [1, true],
    [0, false],
  ])('reports a hidden anchor for __hdx_hidden %p', (hidden, expected) => {
    expect(
      getBrowserTraceContext([{ ...browserSpan, __hdx_hidden: hidden }])
        ?.anchorHidden,
    ).toBe(expected);
  });
});

describe('hasSubSecondTimestamps', () => {
  it.each([
    ["Nullable(DateTime64(9, 'UTC'))", true],
    ['DateTime64(0)', false],
    ['DateTime', false],
  ])('reads a %s timestamp column as %p', (type, expected) => {
    expect(hasSubSecondTimestamps([{ name: 'timestamp', type }])).toBe(
      expected,
    );
  });

  it('is false without a timestamp column', () => {
    expect(hasSubSecondTimestamps(undefined)).toBe(false);
    expect(
      hasSubSecondTimestamps([{ name: 'ts', type: 'DateTime64(9)' }]),
    ).toBe(false);
  });
});

describe('isBrowserEventLogSource', () => {
  it.each([
    'eventNameExpression',
    'eventAttributesExpression',
    'traceIdExpression',
    'spanIdExpression',
  ] as const)('rejects a source without %s', field => {
    expect(isBrowserEventLogSource({ ...logSource, [field]: '' })).toBe(false);
  });
});
