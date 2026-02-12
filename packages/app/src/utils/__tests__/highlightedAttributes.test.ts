import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';

import {
  getHighlightedAttributesFromData,
  isLinkableUrl,
} from '../highlightedAttributes';

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

  it('extracts highlightedRowAttributeExpressions correctly', () => {
    const source: TSource = {
      ...createBasicSource(),
      highlightedRowAttributeExpressions: [
        {
          sqlExpression: 'status',
          alias: 'status',
        },
        {
          sqlExpression: 'endpoint',
          luceneExpression: 'http.endpoint',
          alias: 'endpoint',
        },
      ],
    };

    const data = [
      { status: '200', endpoint: '/api/users' },
      { status: '404', endpoint: '/api/posts' },
      { status: '200', endpoint: '/api/comments' },
    ];

    const meta = [
      { name: 'status', type: 'String' },
      { name: 'endpoint', type: 'String' },
    ];

    const attributes = getHighlightedAttributesFromData(
      source,
      source.highlightedRowAttributeExpressions,
      data,
      meta,
    );

    expect(attributes).toHaveLength(5);
    expect(attributes).toContainEqual({
      sql: 'status',
      displayedKey: 'status',
      value: '200',
      source,
    });
    expect(attributes).toContainEqual({
      sql: 'status',
      displayedKey: 'status',
      value: '404',
      source,
    });
    expect(attributes).toContainEqual({
      sql: 'endpoint',
      displayedKey: 'endpoint',
      value: '/api/users',
      lucene: 'http.endpoint',
      source,
    });
    expect(attributes).toContainEqual({
      sql: 'endpoint',
      displayedKey: 'endpoint',
      value: '/api/posts',
      lucene: 'http.endpoint',
      source,
    });
    expect(attributes).toContainEqual({
      sql: 'endpoint',
      displayedKey: 'endpoint',
      value: '/api/comments',
      lucene: 'http.endpoint',
      source,
    });
  });
});

describe('isLinkableUrl', () => {
  describe('valid http and https URLs', () => {
    it('returns true for simple http URL', () => {
      expect(isLinkableUrl('http://example.com')).toBe(true);
    });

    it('returns true for simple https URL', () => {
      expect(isLinkableUrl('https://example.com')).toBe(true);
    });

    it('returns true for http URL with path', () => {
      expect(isLinkableUrl('http://example.com/path/to/resource')).toBe(true);
    });

    it('returns true for https URL with path', () => {
      expect(isLinkableUrl('https://example.com/path/to/resource')).toBe(true);
    });

    it('returns true for URL with query parameters', () => {
      expect(isLinkableUrl('https://example.com/search?q=test&page=1')).toBe(
        true,
      );
    });

    it('returns true for URL with hash fragment', () => {
      expect(isLinkableUrl('https://example.com/page#section')).toBe(true);
    });

    it('returns true for URL with port number', () => {
      expect(isLinkableUrl('https://example.com:8080/api')).toBe(true);
    });

    it('returns true for URL with authentication', () => {
      expect(isLinkableUrl('https://user:pass@example.com/resource')).toBe(
        true,
      );
    });

    it('returns true for localhost URL', () => {
      expect(isLinkableUrl('http://localhost:3000/api')).toBe(true);
    });

    it('returns true for IP address URL', () => {
      expect(isLinkableUrl('http://192.168.1.1:8080/admin')).toBe(true);
    });

    it('returns true for URL with subdomain', () => {
      expect(isLinkableUrl('https://api.staging.example.com/v1')).toBe(true);
    });
  });

  describe('XSS prevention - javascript protocol', () => {
    it('returns false for javascript: protocol', () => {
      expect(isLinkableUrl('javascript:alert("XSS")')).toBe(false);
    });

    it('returns false for javascript: protocol with void', () => {
      expect(isLinkableUrl('javascript:void(0)')).toBe(false);
    });

    it('returns false for javascript: protocol with encoded payload', () => {
      expect(isLinkableUrl('javascript:eval(atob("YWxlcnQoJ1hTUycp"))')).toBe(
        false,
      );
    });

    it('returns false for javascript: protocol with newline bypass attempt', () => {
      expect(isLinkableUrl('javascript://example.com%0Aalert(1)')).toBe(false);
    });

    it('returns false for javascript: with mixed case', () => {
      expect(isLinkableUrl('JaVaScRiPt:alert(1)')).toBe(false);
    });
  });

  describe('XSS prevention - data protocol', () => {
    it('returns false for data: protocol with HTML', () => {
      expect(
        isLinkableUrl('data:text/html,<script>alert("XSS")</script>'),
      ).toBe(false);
    });

    it('returns false for data: protocol with base64 encoded script', () => {
      expect(
        isLinkableUrl(
          'data:text/html;base64,PHNjcmlwdD5hbGVydCgnWFNTJyk8L3NjcmlwdD4=',
        ),
      ).toBe(false);
    });

    it('returns false for data: protocol with SVG', () => {
      expect(
        isLinkableUrl('data:image/svg+xml,<svg onload=alert("XSS")></svg>'),
      ).toBe(false);
    });
  });

  describe('XSS prevention - other dangerous protocols', () => {
    it('returns false for vbscript: protocol', () => {
      expect(isLinkableUrl('vbscript:msgbox("XSS")')).toBe(false);
    });

    it('returns false for file: protocol', () => {
      expect(isLinkableUrl('file:///etc/passwd')).toBe(false);
    });

    it('returns false for file: protocol on Windows', () => {
      expect(isLinkableUrl('file:///C:/Windows/System32/config/sam')).toBe(
        false,
      );
    });

    it('returns false for about: protocol', () => {
      expect(isLinkableUrl('about:blank')).toBe(false);
    });
  });

  describe('non-http/https protocols', () => {
    it('returns false for ftp: protocol', () => {
      expect(isLinkableUrl('ftp://ftp.example.com/file.zip')).toBe(false);
    });

    it('returns false for mailto: protocol', () => {
      expect(isLinkableUrl('mailto:test@example.com')).toBe(false);
    });

    it('returns false for tel: protocol', () => {
      expect(isLinkableUrl('tel:+1234567890')).toBe(false);
    });

    it('returns false for ssh: protocol', () => {
      expect(isLinkableUrl('ssh://user@host:22/path')).toBe(false);
    });

    it('returns false for ws: protocol', () => {
      expect(isLinkableUrl('ws://example.com/socket')).toBe(false);
    });

    it('returns false for wss: protocol', () => {
      expect(isLinkableUrl('wss://example.com/socket')).toBe(false);
    });
  });

  describe('malformed URLs', () => {
    it('returns false for plain text', () => {
      expect(isLinkableUrl('not a url')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isLinkableUrl('')).toBe(false);
    });

    it('returns false for URL without protocol', () => {
      expect(isLinkableUrl('example.com')).toBe(false);
    });

    it('returns false for protocol without domain', () => {
      expect(isLinkableUrl('http://')).toBe(false);
    });

    it('returns false for missing protocol', () => {
      expect(isLinkableUrl('://example.com')).toBe(false);
    });

    it('returns false for HTML script tag', () => {
      expect(isLinkableUrl('<script>alert("XSS")</script>')).toBe(false);
    });

    it('returns false for script tag embedded in URL-like string', () => {
      expect(isLinkableUrl('http://<script>alert("XSS")</script>')).toBe(false);
    });

    it('returns false for relative URL', () => {
      expect(isLinkableUrl('/path/to/resource')).toBe(false);
    });

    it('returns false for protocol-relative URL', () => {
      expect(isLinkableUrl('//example.com/path')).toBe(false);
    });

    it('returns false for URL with only whitespace', () => {
      expect(isLinkableUrl('   ')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('returns false for null input', () => {
      // @ts-expect-error explicitly testing invalid input
      expect(isLinkableUrl(null)).toBe(false);
    });

    it('returns false for undefined input', () => {
      // @ts-expect-error explicitly testing invalid input
      expect(isLinkableUrl(undefined)).toBe(false);
    });

    it('returns true for URL with unusual but valid characters', () => {
      expect(isLinkableUrl('https://example.com/path-with_special~chars')).toBe(
        true,
      );
    });

    it('returns true for URL with encoded characters', () => {
      expect(isLinkableUrl('https://example.com/path%20with%20spaces')).toBe(
        true,
      );
    });
  });
});
