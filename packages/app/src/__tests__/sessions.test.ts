import type { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/browser';
import type { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
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
  renderChartConfig: jest.fn(async () => ({ sql: 'SQL', params: {} })),
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
    connection: 'conn',
    timestampValueExpression: 'Timestamp',
    defaultTableSelectExpression: 'Timestamp',
    durationExpression: 'Duration',
    durationPrecision: 9,
    traceIdExpression: 'TraceId',
    spanIdExpression: 'SpanId',
    parentSpanIdExpression: 'ParentSpanId',
    spanNameExpression: 'SpanName',
    spanKindExpression: 'SpanKind',
    serviceNameExpression: 'ServiceName',
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

  function setup({
    columns = ['ServiceName', 'TimestampTime'],
    query = jest.fn(async () => ({
      json: async () => ({ data: [{ serviceName: 'web' }] }),
    })),
  }: { columns?: string[]; query?: jest.Mock } = {}) {
    // Partial fakes: only the methods fetchServiceScopeFilters calls.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const metadata = {
      getColumns: jest.fn(async () => columns.map(name => ({ name }))),
    } as unknown as Metadata;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const clickhouseClient = { query } as unknown as ClickhouseClient;
    return { metadata, clickhouseClient, query };
  }

  it('scopes to the session table services over the padded range', async () => {
    const { metadata, clickhouseClient } = setup();
    const filters = await fetchServiceScopeFilters({
      traceSource,
      sessionSource,
      dateRange,
      metadata,
      clickhouseClient,
    });

    expect(filters).toEqual([
      { type: 'sql', condition: "ServiceName IN ('web')" },
    ]);
    expect(jest.mocked(renderChartConfig).mock.lastCall?.[0]).toMatchObject({
      select: [
        { valueExpression: 'DISTINCT ServiceName', alias: 'serviceName' },
      ],
      dateRange: [
        new Date('2026-01-01T00:00:00Z'),
        new Date('2026-01-01T03:00:00Z'),
      ],
    });
  });

  it('escapes and keeps empty service names', async () => {
    const { metadata, clickhouseClient } = setup({
      query: jest.fn(async () => ({
        json: async () => ({
          data: [{ serviceName: "x') OR 1=1 --" }, { serviceName: '' }],
        }),
      })),
    });
    expect(
      await fetchServiceScopeFilters({
        traceSource,
        sessionSource,
        dateRange,
        metadata,
        clickhouseClient,
      }),
    ).toEqual([
      { type: 'sql', condition: "ServiceName IN ('x'') OR 1=1 --', '')" },
    ]);
  });

  it('drops null service names', async () => {
    const { metadata, clickhouseClient } = setup({
      query: jest.fn(async () => ({
        json: async () => ({
          data: [{ serviceName: 'web' }, { serviceName: null }],
        }),
      })),
    });
    expect(
      await fetchServiceScopeFilters({
        traceSource,
        sessionSource,
        dateRange,
        metadata,
        clickhouseClient,
      }),
    ).toEqual([{ type: 'sql', condition: "ServiceName IN ('web')" }]);
  });

  it('returns no filter when the lookup finds no services', async () => {
    const { metadata, clickhouseClient } = setup({
      query: jest.fn(async () => ({ json: async () => ({ data: [] }) })),
    });
    expect(
      await fetchServiceScopeFilters({
        traceSource,
        sessionSource,
        dateRange,
        metadata,
        clickhouseClient,
      }),
    ).toEqual([]);
  });

  it('returns no filter when the lookup throws', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { metadata, clickhouseClient } = setup({
      query: jest.fn(async () => {
        throw new Error('boom');
      }),
    });
    expect(
      await fetchServiceScopeFilters({
        traceSource,
        sessionSource,
        dateRange,
        metadata,
        clickhouseClient,
      }),
    ).toEqual([]);
  });

  it('skips the lookup when the session table has no ServiceName column', async () => {
    const { metadata, clickhouseClient, query } = setup({
      columns: ['TimestampTime'],
    });
    expect(
      await fetchServiceScopeFilters({
        traceSource,
        sessionSource,
        dateRange,
        metadata,
        clickhouseClient,
      }),
    ).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('skips the lookup when the trace source has no service name expression', async () => {
    const { metadata, clickhouseClient, query } = setup();
    expect(
      await fetchServiceScopeFilters({
        traceSource: { ...traceSource, serviceNameExpression: undefined },
        sessionSource,
        dateRange,
        metadata,
        clickhouseClient,
      }),
    ).toEqual([]);
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
