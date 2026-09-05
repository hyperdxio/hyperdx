import { buildRRWebStreamChartConfig } from '@/sessions';

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
