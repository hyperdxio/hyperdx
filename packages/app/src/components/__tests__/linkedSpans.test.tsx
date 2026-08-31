import { SourceKind, TTraceSource } from '@hyperdx/common-utils/dist/types';
import { renderHook } from '@testing-library/react';

import {
  getLinkedSpansConfig,
  getReverseSpanLinksConfig,
  LINKED_SPAN_ALIASES,
  linkedSpanKey,
  useLinkedSpanDetails,
  useReverseSpanLinks,
} from '@/components/linkedSpans';

const mockUseQueriedChartConfig = jest.fn();
jest.mock('@/hooks/useChartConfig', () => ({
  __esModule: true,
  useQueriedChartConfig: (config: unknown, options: unknown) =>
    mockUseQueriedChartConfig(config, options),
}));

const TRACE_SOURCE: TTraceSource = {
  id: 'trace-source',
  kind: SourceKind.Trace,
  name: 'Traces',
  connection: 'conn-1',
  from: { databaseName: 'default', tableName: 'otel_traces' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Timestamp, SpanName',
  traceIdExpression: 'TraceId',
  spanIdExpression: 'SpanId',
  parentSpanIdExpression: 'ParentSpanId',
  spanNameExpression: 'SpanName',
  spanKindExpression: 'SpanKind',
  serviceNameExpression: 'ServiceName',
  durationExpression: 'Duration',
  durationPrecision: 9,
  spanLinksValueExpression: 'Links',
};

const TRACE_ID = 'aaaa1111bbbb2222cccc3333dddd4444';
const SPAN_ID = '1111222233334444';
const ANCHOR = new Date('2024-01-02T12:00:00.000Z');

const EXPECTED_SELECT = [
  {
    valueExpression: 'Timestamp',
    alias: LINKED_SPAN_ALIASES.TIMESTAMP,
  },
  {
    valueExpression: 'TraceId',
    alias: LINKED_SPAN_ALIASES.TRACE_ID,
  },
  { valueExpression: 'SpanId', alias: LINKED_SPAN_ALIASES.SPAN_ID },
  { valueExpression: 'SpanName', alias: LINKED_SPAN_ALIASES.BODY },
  {
    valueExpression: 'ServiceName',
    alias: LINKED_SPAN_ALIASES.SERVICE_NAME,
  },
  {
    valueExpression: '(Duration)/1e6',
    alias: LINKED_SPAN_ALIASES.DURATION_MS,
  },
];

describe('getReverseSpanLinksConfig', () => {
  it('builds an index-friendly has() conjunct plus an exact-pair arrayExists', () => {
    const config = getReverseSpanLinksConfig({
      source: TRACE_SOURCE,
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      anchorDate: ANCHOR,
    });

    expect(config?.where).toBe(
      `has(Links.SpanId, '${SPAN_ID}') AND arrayExists((lt, ls) -> lt = '${TRACE_ID}' AND ls = '${SPAN_ID}', Links.TraceId, Links.SpanId)`,
    );
    expect(config?.whereLanguage).toBe('sql');
  });

  it('escapes quotes in trace and span ids', () => {
    const config = getReverseSpanLinksConfig({
      source: TRACE_SOURCE,
      traceId: "trace'--",
      spanId: "span'--",
      anchorDate: ANCHOR,
    });

    expect(config?.where).toContain("'span\\'--'");
    expect(config?.where).toContain("'trace\\'--'");
    expect(config?.where).not.toContain("'span'--'");
  });

  it('bounds the search to -1h/+24h around the anchor', () => {
    const config = getReverseSpanLinksConfig({
      source: TRACE_SOURCE,
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      anchorDate: ANCHOR,
    });

    expect(config?.dateRange).toEqual([
      new Date('2024-01-02T11:00:00.000Z'),
      new Date('2024-01-03T12:00:00.000Z'),
    ]);
    expect(config?.timestampValueExpression).toBe('Timestamp');
    expect(config?.limit).toEqual({ limit: 50 });
  });

  it('selects display fields under stable aliases', () => {
    const config = getReverseSpanLinksConfig({
      source: TRACE_SOURCE,
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      anchorDate: ANCHOR,
    });

    expect(config?.select).toEqual(EXPECTED_SELECT);
  });

  it('omits optional select fields the source does not define', () => {
    const config = getReverseSpanLinksConfig({
      source: {
        ...TRACE_SOURCE,
        // @ts-expect-error string type
        spanNameExpression: undefined,
        serviceNameExpression: undefined,
        // @ts-expect-error string type
        durationExpression: undefined,
      },
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      anchorDate: ANCHOR,
    });

    expect(config?.select).toEqual(EXPECTED_SELECT.slice(0, 3));
  });

  it.each([
    ['log source', { source: { ...TRACE_SOURCE, kind: SourceKind.Log } }],
    [
      'missing spanLinksValueExpression',
      { source: { ...TRACE_SOURCE, spanLinksValueExpression: undefined } },
    ],
    [
      'missing traceIdExpression',
      { source: { ...TRACE_SOURCE, traceIdExpression: undefined } },
    ],
    ['missing traceId', { traceId: undefined }],
    ['missing spanId', { spanId: undefined }],
    ['missing anchorDate', { anchorDate: undefined }],
  ])('returns null on %s', (_label, overrides) => {
    expect(
      getReverseSpanLinksConfig({
        source: TRACE_SOURCE,
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        anchorDate: ANCHOR,
        ...(overrides as object),
      }),
    ).toBeNull();
  });
});

describe('getLinkedSpansConfig', () => {
  const LINKS = [
    { TraceId: 'trace-a', SpanId: 'span-a' },
    { TraceId: 'trace-b', SpanId: 'span-b' },
  ];

  it('matches trace ids for index pruning and exact pairs via tuple IN', () => {
    const config = getLinkedSpansConfig({
      source: TRACE_SOURCE,
      links: LINKS,
      anchorDate: ANCHOR,
    });

    expect(config?.where).toBe(
      "TraceId IN ('trace-a', 'trace-b') AND (TraceId, SpanId) IN (('trace-a', 'span-a'), ('trace-b', 'span-b'))",
    );
    expect(config?.whereLanguage).toBe('sql');
    expect(config?.select).toEqual(EXPECTED_SELECT);
  });

  it('dedupes repeated links', () => {
    const config = getLinkedSpansConfig({
      source: TRACE_SOURCE,
      links: [LINKS[0], LINKS[0], LINKS[1]],
      anchorDate: ANCHOR,
    });

    expect(config?.where).toBe(
      "TraceId IN ('trace-a', 'trace-b') AND (TraceId, SpanId) IN (('trace-a', 'span-a'), ('trace-b', 'span-b'))",
    );
  });

  it('bounds the search to -24h/+1h around the anchor (links point backwards in time)', () => {
    const config = getLinkedSpansConfig({
      source: TRACE_SOURCE,
      links: LINKS,
      anchorDate: ANCHOR,
    });

    expect(config?.dateRange).toEqual([
      new Date('2024-01-01T12:00:00.000Z'),
      new Date('2024-01-02T13:00:00.000Z'),
    ]);
    expect(config?.limit).toEqual({ limit: 50 });
  });

  it.each([
    ['no links', { links: [] }],
    ['log source', { source: { ...TRACE_SOURCE, kind: SourceKind.Log } }],
    ['missing anchorDate', { anchorDate: undefined }],
  ])('returns null on %s', (_label, overrides) => {
    expect(
      getLinkedSpansConfig({
        source: TRACE_SOURCE,
        links: LINKS,
        anchorDate: ANCHOR,
        ...(overrides as object),
      }),
    ).toBeNull();
  });
});

describe('useReverseSpanLinks', () => {
  beforeEach(() => {
    mockUseQueriedChartConfig.mockReset();
  });

  it('disables the query when the config cannot be built', () => {
    mockUseQueriedChartConfig.mockReturnValue({ data: undefined });

    const { result } = renderHook(() =>
      useReverseSpanLinks({
        source: TRACE_SOURCE,
        traceId: undefined,
        spanId: SPAN_ID,
        anchorDate: ANCHOR,
      }),
    );

    expect(result.current.links).toEqual([]);
    expect(mockUseQueriedChartConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: false }),
    );
  });

  it('maps result rows and drops rows missing ids or matching the current span', () => {
    mockUseQueriedChartConfig.mockReturnValue({
      data: {
        data: [
          {
            [LINKED_SPAN_ALIASES.TRACE_ID]: 'other-trace',
            [LINKED_SPAN_ALIASES.SPAN_ID]: 'other-span',
            [LINKED_SPAN_ALIASES.BODY]: 'process message',
            [LINKED_SPAN_ALIASES.SERVICE_NAME]: 'consumer',
            [LINKED_SPAN_ALIASES.TIMESTAMP]: '2024-01-02 12:00:01',
            [LINKED_SPAN_ALIASES.DURATION_MS]: 12.5,
          },
          // The span being viewed (self-link) is filtered out.
          {
            [LINKED_SPAN_ALIASES.TRACE_ID]: TRACE_ID,
            [LINKED_SPAN_ALIASES.SPAN_ID]: SPAN_ID,
          },
          // Rows without string ids can't be navigated to.
          {
            [LINKED_SPAN_ALIASES.TRACE_ID]: 'trace-without-span-id',
          },
          // Duplicate (TraceId, SpanId) pairs collapse to one entry.
          {
            [LINKED_SPAN_ALIASES.TRACE_ID]: 'other-trace',
            [LINKED_SPAN_ALIASES.SPAN_ID]: 'other-span',
          },
        ],
      },
    });

    const { result } = renderHook(() =>
      useReverseSpanLinks({
        source: TRACE_SOURCE,
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        anchorDate: ANCHOR,
      }),
    );

    expect(result.current.links).toEqual([
      {
        TraceId: 'other-trace',
        SpanId: 'other-span',
        spanName: 'process message',
        serviceName: 'consumer',
        timestamp: '2024-01-02 12:00:01',
        durationMs: 12.5,
      },
    ]);
    expect(mockUseQueriedChartConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: true }),
    );
  });
});

describe('useLinkedSpanDetails', () => {
  beforeEach(() => {
    mockUseQueriedChartConfig.mockReset();
  });

  it('disables the query when there are no links', () => {
    mockUseQueriedChartConfig.mockReturnValue({ data: undefined });

    const { result } = renderHook(() =>
      useLinkedSpanDetails({
        source: TRACE_SOURCE,
        links: [],
        anchorDate: ANCHOR,
      }),
    );

    expect(result.current.details.size).toBe(0);
    expect(mockUseQueriedChartConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: false }),
    );
  });

  it('maps result rows into a lookup keyed by trace/span pair', () => {
    mockUseQueriedChartConfig.mockReturnValue({
      data: {
        data: [
          {
            [LINKED_SPAN_ALIASES.TRACE_ID]: 'trace-a',
            [LINKED_SPAN_ALIASES.SPAN_ID]: 'span-a',
            [LINKED_SPAN_ALIASES.BODY]: 'publish message',
            [LINKED_SPAN_ALIASES.SERVICE_NAME]: 'producer',
            [LINKED_SPAN_ALIASES.TIMESTAMP]: '2024-01-02 11:59:59',
            [LINKED_SPAN_ALIASES.DURATION_MS]: 3.25,
          },
          {
            [LINKED_SPAN_ALIASES.TRACE_ID]: 'trace-without-span-id',
          },
        ],
      },
    });

    const { result } = renderHook(() =>
      useLinkedSpanDetails({
        source: TRACE_SOURCE,
        links: [{ TraceId: 'trace-a', SpanId: 'span-a' }],
        anchorDate: ANCHOR,
      }),
    );

    expect(result.current.details.size).toBe(1);
    expect(
      result.current.details.get(linkedSpanKey('trace-a', 'span-a')),
    ).toEqual({
      TraceId: 'trace-a',
      SpanId: 'span-a',
      spanName: 'publish message',
      serviceName: 'producer',
      timestamp: '2024-01-02 11:59:59',
      durationMs: 3.25,
    });
  });
});
