import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';

import { getHighlightedAttributesFromData } from '../highlightedAttributes';

describe('getHighlightedAttributesFromData', () => {
  const createBasicSource = (
    highlightedTraceAttributeExpressions: any[] = [],
  ): TSource => ({
    kind: SourceKind.Trace,
    from: {
      databaseName: 'default',
      tableName: 'otel_traces',
    },
    timestampValueExpression: 'Timestamp',
    connection: 'test-connection',
    name: 'Traces',
    highlightedTraceAttributeExpressions,
    id: 'test-source-id',
  });

  const basicMeta = [
    { name: 'Body', type: 'String' },
    { name: 'Timestamp', type: 'DateTime64(9)' },
    { name: 'method', type: 'String' },
  ];

  it('extracts attributes from data correctly', () => {
    const data: Record<string, string | number | object>[] = [
      {
        Body: 'POST',
        Timestamp: '2025-11-12T21:27:00.053000000Z',
        SpanId: 'a51d12055f2058b9',
        ServiceName: 'hdx-oss-dev-api',
        method: 'POST',
        "SpanAttributes['http.host']": 'localhost:8123',
        Duration: 0.020954166,
        ParentSpanId: '013cca18a6e626a6',
        StatusCode: 'Unset',
        SpanAttributes: {
          'http.flavor': '1.1',
          'http.host': 'localhost:8123',
          'http.method': 'POST',
        },
        type: 'trace',
      },
      {
        Body: 'POST',
        Timestamp: '2025-11-12T21:27:00.053000000Z',
        SpanId: 'a51d12055f2058b9',
        ServiceName: 'hdx-oss-dev-api',
        method: 'GET',
        "SpanAttributes['http.host']": 'localhost:8123',
        Duration: 0.020954166,
        ParentSpanId: '013cca18a6e626a6',
        StatusCode: 'Unset',
        SpanAttributes: {
          'http.flavor': '1.1',
          'http.host': 'localhost:8123',
          'http.method': 'POST',
        },
        type: 'trace',
      },
    ];

    const meta = [
      {
        name: 'Body',
        type: 'LowCardinality(String)',
      },
      {
        name: 'Timestamp',
        type: 'DateTime64(9)',
      },
      {
        name: 'SpanId',
        type: 'String',
      },
      {
        name: 'ServiceName',
        type: 'LowCardinality(String)',
      },
      {
        name: 'method',
        type: 'String',
      },
      {
        name: "SpanAttributes['http.host']",
        type: 'String',
      },
      {
        name: 'Duration',
        type: 'Float64',
      },
      {
        name: 'ParentSpanId',
        type: 'String',
      },
      {
        name: 'StatusCode',
        type: 'LowCardinality(String)',
      },
      {
        name: 'SpanAttributes',
        type: 'Map(LowCardinality(String), String)',
      },
    ];

    const source: TSource = {
      kind: SourceKind.Trace,
      from: {
        databaseName: 'default',
        tableName: 'otel_traces',
      },
      timestampValueExpression: 'Timestamp',
      connection: '68dd82484f54641b08667893',
      name: 'Traces',
      displayedTimestampValueExpression: 'Timestamp',
      implicitColumnExpression: 'SpanName',
      serviceNameExpression: 'ServiceName',
      bodyExpression: 'SpanName',
      eventAttributesExpression: 'SpanAttributes',
      resourceAttributesExpression: 'ResourceAttributes',
      defaultTableSelectExpression:
        'Timestamp,ServiceName,StatusCode,round(Duration/1e6),SpanName',
      traceIdExpression: 'TraceId',
      spanIdExpression: 'SpanId',
      durationExpression: 'Duration',
      durationPrecision: 9,
      parentSpanIdExpression: 'ParentSpanId',
      spanNameExpression: 'SpanName',
      spanKindExpression: 'SpanKind',
      statusCodeExpression: 'StatusCode',
      statusMessageExpression: 'StatusMessage',
      sessionSourceId: '68dd82484f54641b0866789e',
      logSourceId: '6900eed982d3b3dfeff12a29',
      highlightedTraceAttributeExpressions: [
        {
          sqlExpression: "SpanAttributes['http.method']",
          alias: 'method',
        },
        {
          sqlExpression: "SpanAttributes['http.host']",
          luceneExpression: 'SpanAttributes.http.host',
          alias: '',
        },
      ],
      id: '68dd82484f54641b08667899',
    };

    const attributes = getHighlightedAttributesFromData(
      source,
      source.highlightedTraceAttributeExpressions,
      data,
      meta,
    );

    expect(attributes).toHaveLength(3);
    expect(attributes).toContainEqual({
      sql: "SpanAttributes['http.method']",
      displayedKey: 'method',
      value: 'POST',
      source,
    });
    expect(attributes).toContainEqual({
      sql: "SpanAttributes['http.method']",
      displayedKey: 'method',
      value: 'GET',
      source,
    });
    expect(attributes).toContainEqual({
      sql: "SpanAttributes['http.host']",
      displayedKey: "SpanAttributes['http.host']",
      value: 'localhost:8123',
      lucene: 'SpanAttributes.http.host',
      source,
    });
  });

  it('returns empty array when data is empty', () => {
    const source = createBasicSource([
      { sqlExpression: 'method', alias: 'method' },
    ]);
    const attributes = getHighlightedAttributesFromData(
      source,
      source.highlightedTraceAttributeExpressions,
      [],
      basicMeta,
    );
    expect(attributes).toEqual([]);
  });

  it('returns empty array when highlightedTraceAttributeExpressions is undefined', () => {
    const source = createBasicSource();
    const data = [{ method: 'POST' }];
    const attributes = getHighlightedAttributesFromData(
      source,
      source.highlightedTraceAttributeExpressions,
      data,
      basicMeta,
    );
    expect(attributes).toEqual([]);
  });

  it('returns empty array when highlightedTraceAttributeExpressions is empty', () => {
    const source = createBasicSource([]);
    const data = [{ method: 'POST' }];
    const attributes = getHighlightedAttributesFromData(
      source,
      source.highlightedTraceAttributeExpressions,
      data,
      basicMeta,
    );
    expect(attributes).toEqual([]);
  });

  it('filters out non-string values', () => {
    const source = createBasicSource([
      { sqlExpression: 'method', alias: 'method' },
      { sqlExpression: 'count', alias: 'count' },
      { sqlExpression: 'isActive', alias: 'isActive' },
    ]);
    const data = [
      {
        method: 'POST', // string - should be included
        count: 123, // number - should be filtered out
        isActive: true, // boolean - should be filtered out
      },
    ];
    const meta = [
      { name: 'method', type: 'String' },
      { name: 'count', type: 'Int32' },
      { name: 'isActive', type: 'Bool' },
    ];
    const attributes = getHighlightedAttributesFromData(
      source,
      source.highlightedTraceAttributeExpressions,
      data,
      meta,
    );

    expect(attributes).toHaveLength(1);
    expect(attributes[0]).toEqual({
      displayedKey: 'method',
      value: 'POST',
      sql: 'method',
      lucene: undefined,
      source,
    });
  });

  it('deduplicates values from multiple rows', () => {
    const source = createBasicSource([
      { sqlExpression: 'method', alias: 'method' },
    ]);
    const data = [
      { method: 'POST' },
      { method: 'POST' }, // duplicate
      { method: 'GET' },
      { method: 'POST' }, // duplicate
    ];
    const attributes = getHighlightedAttributesFromData(
      source,
      source.highlightedTraceAttributeExpressions,
      data,
      basicMeta,
    );

    expect(attributes).toHaveLength(2);
    expect(attributes.map(a => a.value).sort()).toEqual(['GET', 'POST']);
  });

  it('uses sqlExpression as displayedKey when alias is empty string', () => {
    const source = createBasicSource([
      { sqlExpression: "SpanAttributes['http.host']", alias: '' },
    ]);
    const data = [{ "SpanAttributes['http.host']": 'localhost:8080' }];
    const meta = [
      { name: "SpanAttributes['http.host']", type: 'String' },
      { name: 'SpanAttributes', type: 'JSON' },
    ];
    const attributes = getHighlightedAttributesFromData(
      source,
      source.highlightedTraceAttributeExpressions,
      data,
      meta,
    );

    expect(attributes).toHaveLength(1);
    expect(attributes[0].displayedKey).toBe("SpanAttributes['http.host']");
  });

  it('uses sqlExpression as displayedKey when alias is not provided', () => {
    const source = createBasicSource([
      { sqlExpression: 'ServiceName' } as any, // No alias
    ]);
    const data = [{ ServiceName: 'api-service' }];
    const meta = [{ name: 'ServiceName', type: 'String' }];
    const attributes = getHighlightedAttributesFromData(
      source,
      source.highlightedTraceAttributeExpressions,
      data,
      meta,
    );

    expect(attributes).toHaveLength(1);
    expect(attributes[0].displayedKey).toBe('ServiceName');
  });

  it('includes lucene expression when provided', () => {
    const source = createBasicSource([
      {
        sqlExpression: "SpanAttributes['http.method']",
        alias: 'method',
        luceneExpression: 'http.method',
      },
    ]);
    const data = [{ method: 'POST' }];
    const attributes = getHighlightedAttributesFromData(
      source,
      source.highlightedTraceAttributeExpressions,
      data,
      basicMeta,
    );

    expect(attributes).toHaveLength(1);
    expect(attributes[0].lucene).toBe('http.method');
  });

  it('omits lucene when not provided', () => {
    const source = createBasicSource([
      { sqlExpression: 'method', alias: 'method' },
    ]);
    const data = [{ method: 'POST' }];
    const attributes = getHighlightedAttributesFromData(
      source,
      source.highlightedTraceAttributeExpressions,
      data,
      basicMeta,
    );

    expect(attributes).toHaveLength(1);
    expect(attributes[0].lucene).toBeUndefined();
  });

  it('handles multiple attributes with different values', () => {
    const source = createBasicSource([
      { sqlExpression: 'method', alias: 'method' },
      { sqlExpression: 'status', alias: 'status' },
    ]);
    const data = [
      { method: 'POST', status: '200' },
      { method: 'GET', status: '404' },
    ];
    const meta = [
      { name: 'method', type: 'String' },
      { name: 'status', type: 'String' },
    ];
    const attributes = getHighlightedAttributesFromData(
      source,
      source.highlightedTraceAttributeExpressions,
      data,
      meta,
    );

    expect(attributes).toHaveLength(4);
    expect(
      attributes.filter(a => a.displayedKey === 'method').map(a => a.value),
    ).toEqual(['POST', 'GET']);
    expect(
      attributes.filter(a => a.displayedKey === 'status').map(a => a.value),
    ).toEqual(['200', '404']);
  });

  it('ignores rows with null attribute values', () => {
    const source = createBasicSource([
      { sqlExpression: 'method', alias: 'method' },
    ]);
    const data = [{ method: 'POST' }, { method: null }, { method: 'GET' }];
    const attributes = getHighlightedAttributesFromData(
      source,
      source.highlightedTraceAttributeExpressions,
      data,
      basicMeta,
    );

    expect(attributes).toHaveLength(2);
    expect(attributes.map(a => a.value).sort()).toEqual(['GET', 'POST']);
  });

  it('ignores rows with undefined attribute values', () => {
    const source = createBasicSource([
      { sqlExpression: 'method', alias: 'method' },
    ]);
    const data = [{ method: 'POST' }, { method: undefined }, { method: 'GET' }];
    const attributes = getHighlightedAttributesFromData(
      source,
      source.highlightedTraceAttributeExpressions,
      data,
      basicMeta,
    );

    expect(attributes).toHaveLength(2);
    expect(attributes.map(a => a.value).sort()).toEqual(['GET', 'POST']);
  });

  it('ignores rows with empty string values', () => {
    const source = createBasicSource([
      { sqlExpression: 'method', alias: 'method' },
    ]);
    const data = [{ method: 'POST' }, { method: '' }, { method: 'GET' }];
    const attributes = getHighlightedAttributesFromData(
      source,
      source.highlightedTraceAttributeExpressions,
      data,
      basicMeta,
    );

    expect(attributes).toHaveLength(2);
    expect(attributes.map(a => a.value).sort()).toEqual(['GET', 'POST']);
  });

  it('handles errors gracefully and returns empty array', () => {
    // Create a source that will cause an error during iteration
    const source = createBasicSource([
      { sqlExpression: 'method', alias: 'method' },
    ]);

    // Mock console.error to suppress error output during test
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    // Create data that throws when accessed
    const data = [
      Object.create(
        {},
        {
          method: {
            get() {
              throw new Error('Test error');
            },
          },
        },
      ),
    ];

    const attributes = getHighlightedAttributesFromData(
      source,
      source.highlightedTraceAttributeExpressions,
      data,
      basicMeta,
    );

    expect(attributes).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error extracting attributes from data',
      expect.any(Error),
    );

    consoleErrorSpy.mockRestore();
  });

  it('includes source reference in each attribute', () => {
    const source = createBasicSource([
      { sqlExpression: 'method', alias: 'method' },
    ]);
    const data = [{ method: 'POST' }, { method: 'GET' }];
    const attributes = getHighlightedAttributesFromData(
      source,
      source.highlightedTraceAttributeExpressions,
      data,
      basicMeta,
    );

    expect(attributes).toHaveLength(2);
    attributes.forEach(attr => {
      expect(attr.source).toBe(source);
    });
  });
});
