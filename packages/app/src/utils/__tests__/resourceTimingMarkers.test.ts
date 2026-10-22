import {
  logSource,
  SPAN_START,
  SPAN_START_MS,
  TIMING_TIMESTAMP,
} from '@/hooks/__fixtures__/browserTraceEvents';
import {
  buildResourceTimingQuery,
  getResourceTimingMarkers,
  resourceTimingRowKey,
} from '@/utils/resourceTimingMarkers';

const traceRows = [{ SpanId: 'span-1', Timestamp: SPAN_START }];
const TIMESTAMP_META = [{ name: 'timestamp', type: 'DateTime64(9)' }];

const prefixed = (values: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      `browser.resource_timing.${key}`,
      value,
    ]),
  );

const sameOrigin = prefixed({
  fetch_start: '1000.5',
  domain_lookup_start: '1001',
  domain_lookup_end: '1001.25',
  connect_start: '1001.5',
  secure_connection_start: '0',
  connect_end: '1002',
  request_start: '1002',
  response_start: '1009',
  response_end: '1011.5',
  redirect_start: '0',
  duration: '11',
  transfer_size: '558',
  encoded_body_size: '1536',
  decoded_body_size: '20480',
  next_hop_protocol: 'http/1.1',
  initiator_type: 'fetch',
});

const timingRow = (attributes: unknown, overrides: object = {}) => ({
  span_id: 'span-1',
  timestamp: TIMING_TIMESTAMP,
  attributes,
  ...overrides,
});

const draw = (
  row: Record<string, unknown>,
  spans: Parameters<typeof getResourceTimingMarkers>[1] = traceRows,
  meta = TIMESTAMP_META,
) => getResourceTimingMarkers({ data: [row], meta }, spans);

describe('getResourceTimingMarkers', () => {
  it('places dots in sdk-trace-web order relative to the span start', () => {
    const { markersBySpanId, drawnRowKeys } = draw(timingRow(sameOrigin));

    expect(markersBySpanId.get('span-1')).toEqual([
      { name: 'fetchStart', epochMs: SPAN_START_MS, attributes: {} },
      {
        name: 'domainLookupStart',
        epochMs: SPAN_START_MS + 0.5,
        attributes: {},
      },
      {
        name: 'domainLookupEnd',
        epochMs: SPAN_START_MS + 0.75,
        attributes: {},
      },
      { name: 'connectStart', epochMs: SPAN_START_MS + 1, attributes: {} },
      { name: 'connectEnd', epochMs: SPAN_START_MS + 1.5, attributes: {} },
      { name: 'requestStart', epochMs: SPAN_START_MS + 1.5, attributes: {} },
      { name: 'responseStart', epochMs: SPAN_START_MS + 8.5, attributes: {} },
      {
        name: 'responseEnd',
        epochMs: SPAN_START_MS + 11,
        attributes: {
          duration: '11ms',
          transfer_size: '558 B',
          encoded_body_size: '1.5 KB',
          decoded_body_size: '20.0 KB',
          next_hop_protocol: 'http/1.1',
        },
      },
    ]);
    expect([...drawnRowKeys]).toEqual([
      resourceTimingRowKey('span-1', TIMING_TIMESTAMP),
    ]);
  });

  it('skips the phases and sizes a cross-origin request leaves at zero, and empty tooltip values', () => {
    const crossOrigin = prefixed({
      fetch_start: '1000.5',
      domain_lookup_start: '0',
      connect_start: '0',
      request_start: '0',
      response_start: '0',
      response_end: '1011.5',
      duration: '11',
      transfer_size: '0',
      encoded_body_size: '0',
      decoded_body_size: '0',
      next_hop_protocol: '',
    });

    expect(draw(timingRow(crossOrigin)).markersBySpanId.get('span-1')).toEqual([
      { name: 'fetchStart', epochMs: SPAN_START_MS, attributes: {} },
      {
        name: 'responseEnd',
        epochMs: SPAN_START_MS + 11,
        attributes: { duration: '11ms' },
      },
    ]);
  });

  it('keeps a zero transfer size next to a body size, as for a cache hit', () => {
    const cached = prefixed({
      fetch_start: '1000.5',
      response_end: '1011.5',
      transfer_size: '0',
      encoded_body_size: '221',
      decoded_body_size: '221',
    });

    expect(
      draw(timingRow(cached)).markersBySpanId.get('span-1')?.at(-1)?.attributes,
    ).toEqual({
      transfer_size: '0 B',
      encoded_body_size: '221 B',
      decoded_body_size: '221 B',
    });
  });

  it('reads nested JSON numbers and quoted Int64 values', () => {
    const json = {
      browser: {
        resource_timing: {
          fetch_start: 1000.5,
          response_end: 1011.5,
          transfer_size: '558',
        },
      },
    };

    expect(draw(timingRow(json)).markersBySpanId.get('span-1')).toEqual([
      { name: 'fetchStart', epochMs: SPAN_START_MS, attributes: {} },
      {
        name: 'responseEnd',
        epochMs: SPAN_START_MS + 11,
        attributes: { transfer_size: '558 B' },
      },
    ]);
  });

  it.each([
    ['without fetch_start', timingRow(prefixed({ response_end: '1011.5' }))],
    ['with a zero fetch_start', timingRow(prefixed({ fetch_start: '0' }))],
    [
      'on a span outside the trace',
      timingRow(sameOrigin, { span_id: 'other' }),
    ],
    ['without a span id', timingRow(sameOrigin, { span_id: '' })],
    ['with attributes that are not a map', timingRow('not a map')],
  ])('draws nothing and keeps the row for a log %s', (_name, row) => {
    const { markersBySpanId, drawnRowKeys } = draw(row);
    expect(markersBySpanId.size).toBe(0);
    expect(drawnRowKeys.size).toBe(0);
  });

  it.each([
    [
      'its span is hidden',
      [{ ...traceRows[0], __hdx_hidden: true }],
      TIMESTAMP_META,
    ],
    [
      'the timestamp column is whole seconds',
      traceRows,
      [{ name: 'timestamp', type: 'DateTime' }],
    ],
  ])('draws a log but keeps its row when %s', (_name, spans, meta) => {
    const { markersBySpanId, drawnRowKeys } = draw(
      timingRow(sameOrigin),
      spans,
      meta,
    );
    expect(markersBySpanId.get('span-1')).toHaveLength(8);
    expect(drawnRowKeys.size).toBe(0);
  });
});

describe('buildResourceTimingQuery', () => {
  const source = {
    ...logSource,
    timestampValueExpression: 'TimestampTime',
    displayedTimestampValueExpression: 'Timestamp',
  };
  const context = {
    serviceNames: ['web', 'web-worker'],
    anchorMs: SPAN_START_MS,
    endMs: Date.parse('2026-10-22T04:52:38.100Z'),
    anchorHidden: false,
    sessionId: 's1',
    serviceName: 'web',
  };

  it('selects the span id, displayed timestamp and attributes of the trace timing logs', () => {
    expect(
      buildResourceTimingQuery({ logSource: source, context, traceId: "t'1" }),
    ).toEqual({
      source: 'logs',
      connection: 'conn',
      from: { databaseName: 'default', tableName: 'otel_logs' },
      timestampValueExpression: 'TimestampTime',
      select: [
        { valueExpression: 'SpanId', alias: 'span_id' },
        { valueExpression: 'Timestamp', alias: 'timestamp' },
        { valueExpression: 'LogAttributes', alias: 'attributes' },
      ],
      where: "TraceId = 't\\'1'",
      whereLanguage: 'sql',
      filters: [
        {
          type: 'sql',
          condition: "toString(EventName) = 'browser.resource_timing'",
        },
        {
          type: 'sql',
          condition: "toString(ServiceName) IN ('web', 'web-worker')",
        },
      ],
      dateRange: [
        new Date('2026-10-22T04:52:37.000Z'),
        new Date('2026-10-22T04:57:38.100Z'),
      ],
      limit: { limit: 1000 },
    });
  });

  it('places a JSON path service name inside toString', () => {
    const query = buildResourceTimingQuery({
      logSource: {
        ...source,
        serviceNameExpression: 'ResourceAttributes.service.name',
      },
      context,
      traceId: 't1',
    });
    expect(query.filters?.[1]).toEqual({
      type: 'sql',
      condition:
        "toString(ResourceAttributes.service.name) IN ('web', 'web-worker')",
    });
  });

  it.each([
    [
      'the source has no service name',
      { ...source, serviceNameExpression: undefined },
      context,
    ],
    [
      'the spans have no service name',
      source,
      { ...context, serviceNames: [] },
    ],
  ])('leaves out the service filter when %s', (_name, querySource, ctx) => {
    expect(
      buildResourceTimingQuery({
        logSource: querySource,
        context: ctx,
        traceId: 't1',
      }).filters,
    ).toHaveLength(1);
  });
});
