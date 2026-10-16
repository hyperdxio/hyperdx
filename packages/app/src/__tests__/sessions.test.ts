import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/browser';
import {
  Metadata,
  MetadataCache,
} from '@hyperdx/common-utils/dist/core/metadata';
import { renderChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import {
  SourceKind,
  TSessionSource,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';

import {
  buildRRWebStreamChartConfig,
  buildSessionsQueryFilters,
  fetchServiceScopeFilters,
} from '@/sessions';

jest.mock('@hyperdx/common-utils/dist/core/renderChartConfig', () => ({
  ...jest.requireActual('@hyperdx/common-utils/dist/core/renderChartConfig'),
  renderChartConfig: jest.fn(async () => ({ sql: 'SQL', params: { p: 1 } })),
}));

describe('buildRRWebStreamChartConfig', () => {
  // Mirrors useFieldExpressionGenerator's output for Map columns
  const getSessionSourceFieldExpression = (column: string, key: string) =>
    `${column}['${key}']`;

  const config = buildRRWebStreamChartConfig({
    source: {
      from: { databaseName: 'default', tableName: 'hyperdx_sessions' },
      timestampValueExpression: 'TimestampTime',
      connection: 'test-connection',
    },
    serviceName: 'my-service',
    sessionId: 'session-1',
    startDate: new Date(1000),
    endDate: new Date(2000),
    limit: 1000000,
    offset: 0,
    getSessionSourceFieldExpression,
  });

  it('orders by timestamp with numeric offset and chunk tiebreaks', () => {
    // Chunks of one rrweb event share a single timestamp, so without the
    // tiebreaks ClickHouse can return them in arbitrary order and the replay
    // reassembly gets scrambled (hyperdxio/hyperdx#2569). The casts matter
    // too: the attributes are strings, and lexicographically '10' < '2'.
    expect(config.orderBy).toBe(
      "TimestampTime ASC, toUInt64OrZero(LogAttributes['rr-web.offset']) ASC, toUInt64OrZero(LogAttributes['rr-web.chunk']) ASC",
    );
  });

  it('selects the chunk metadata needed for reassembly', () => {
    expect(config.select).toEqual(
      expect.arrayContaining([
        { valueExpression: "LogAttributes['rr-web.chunk']", alias: 'ck' },
        {
          valueExpression: "LogAttributes['rr-web.total-chunks']",
          alias: 'tcks',
        },
        { valueExpression: "LogAttributes['rr-web.event']", alias: 'ev' },
      ]),
    );
  });

  it('scopes the query to the service and session', () => {
    expect(config.where).toBe(
      'ServiceName:"my-service" AND ResourceAttributes.rum.sessionId:"session-1"',
    );
    expect(config.dateRange).toEqual([new Date(1000), new Date(2000)]);
    expect(config.limit).toEqual({ limit: 1000000, offset: 0 });
  });
});

describe('fetchServiceScopeFilters', () => {
  const traceSource: TTraceSource = {
    id: 'traces',
    name: 'Traces',
    kind: SourceKind.Trace,
    from: { databaseName: 'default', tableName: 'otel_traces' },
    connection: 'trace-conn',
    timestampValueExpression: 'Timestamp',
    defaultTableSelectExpression: 'Timestamp',
    durationExpression: 'Duration',
    durationPrecision: 9,
    traceIdExpression: 'TraceId',
    spanIdExpression: 'SpanId',
    parentSpanIdExpression: 'ParentSpanId',
    spanNameExpression: 'SpanName',
    spanKindExpression: 'SpanKind',
    // Differs from the session table's ServiceName column so the tests catch
    // the two being swapped.
    serviceNameExpression: "ResourceAttributes['service.name']",
  };
  const sessionSource: TSessionSource = {
    id: 'sessions',
    name: 'Sessions',
    kind: SourceKind.Session,
    from: { databaseName: 'default', tableName: 'hyperdx_sessions' },
    connection: 'conn',
    timestampValueExpression: 'TimestampTime',
    traceSourceId: 'traces',
  };
  const dateRange: [Date, Date] = [
    new Date('2026-01-01T01:00:00Z'),
    new Date('2026-01-01T02:00:00Z'),
  ];

  function jsonResultSet(data: unknown[]) {
    const text = JSON.stringify({ data });
    return {
      text: async () => text,
      // JSON.parse returns any, which satisfies json<T>() without a cast.
      json: async () => JSON.parse(text),
      stream: () => {
        throw new Error('not implemented');
      },
      close: () => {},
      query_id: 'query-id',
      response_headers: {},
    };
  }

  function setup({
    columns = ['ServiceName', 'TimestampTime'],
    rows = [{ serviceName: 'web' }],
  }: { columns?: string[]; rows?: unknown[] } = {}) {
    const clickhouseClient = new ClickhouseClient({ host: '' });
    const metadata = new Metadata(clickhouseClient, new MetadataCache());
    const getColumns = jest.spyOn(metadata, 'getColumns').mockResolvedValue(
      columns.map(name => ({
        name,
        type: 'String',
        codec_expression: '',
        comment: '',
        default_expression: '',
        default_type: '',
        ttl_expression: '',
      })),
    );
    const query = jest
      .spyOn(clickhouseClient, 'query')
      .mockImplementation(async () => jsonResultSet(rows));
    const run = (overrides: { traceSource?: TTraceSource } = {}) =>
      fetchServiceScopeFilters({
        traceSource,
        sessionSource,
        dateRange,
        metadata,
        clickhouseClient,
        ...overrides,
      });
    return { run, metadata, getColumns, query };
  }

  it('queries the session table services over the padded range', async () => {
    const { run, metadata, getColumns, query } = setup();

    expect(await run()).toEqual([
      {
        type: 'sql',
        condition: "ResourceAttributes['service.name'] IN ('web')",
      },
    ]);
    expect(getColumns).toHaveBeenCalledWith({
      databaseName: 'default',
      tableName: 'hyperdx_sessions',
      connectionId: 'conn',
    });
    expect(renderChartConfig).toHaveBeenCalledWith(
      {
        select: [
          { valueExpression: 'DISTINCT ServiceName', alias: 'serviceName' },
        ],
        from: { databaseName: 'default', tableName: 'hyperdx_sessions' },
        dateRange: [
          new Date('2026-01-01T00:00:00Z'),
          new Date('2026-01-01T03:00:00Z'),
        ],
        where: '',
        timestampValueExpression: 'TimestampTime',
        connection: 'conn',
      },
      metadata,
      undefined,
    );
    expect(query).toHaveBeenCalledWith({
      query: 'SQL',
      query_params: { p: 1 },
      connectionId: 'conn',
      format: 'JSON',
    });
  });

  it('escapes and keeps empty service names', async () => {
    const { run } = setup({
      rows: [{ serviceName: "x') OR 1=1 --" }, { serviceName: '' }],
    });
    expect(await run()).toEqual([
      {
        type: 'sql',
        condition:
          "ResourceAttributes['service.name'] IN ('x'') OR 1=1 --', '')",
      },
    ]);
  });

  it('drops null service names', async () => {
    const { run } = setup({
      rows: [{ serviceName: 'web' }, { serviceName: null }],
    });
    expect(await run()).toEqual([
      {
        type: 'sql',
        condition: "ResourceAttributes['service.name'] IN ('web')",
      },
    ]);
  });

  it('returns no filter when the lookup finds no services', async () => {
    const { run } = setup({ rows: [] });
    expect(await run()).toEqual([]);
  });

  it('returns no filter and warns when the lookup throws', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { run, query } = setup();
    query.mockRejectedValue(new Error('boom'));
    expect(await run()).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('skips the lookup when the session table has no ServiceName column', async () => {
    const { run, query } = setup({ columns: ['TimestampTime'] });
    expect(await run()).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('skips the lookup when the trace source has no service name expression', async () => {
    const { run, getColumns, query } = setup();
    expect(
      await run({
        traceSource: { ...traceSource, serviceNameExpression: undefined },
      }),
    ).toEqual([]);
    expect(getColumns).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('buildSessionsQueryFilters', () => {
  const scope = [{ type: 'sql', condition: "ServiceName IN ('web')" }] as const;

  it('puts the scope before a lucene query', () => {
    expect(buildSessionsQueryFilters([...scope], 'foo', 'lucene')).toEqual([
      ...scope,
      { type: 'lucene', condition: 'foo' },
    ]);
  });

  it('keeps a SQL query as SQL', () => {
    expect(buildSessionsQueryFilters([...scope], 'a = 1', 'sql')).toEqual([
      ...scope,
      { type: 'sql', condition: 'a = 1' },
    ]);
  });

  it('treats a missing language as lucene', () => {
    expect(buildSessionsQueryFilters([], 'foo', undefined)).toEqual([
      { type: 'lucene', condition: 'foo' },
    ]);
  });

  it('returns no filters with no scope and no query', () => {
    expect(buildSessionsQueryFilters([], '', 'lucene')).toEqual([]);
  });
});
