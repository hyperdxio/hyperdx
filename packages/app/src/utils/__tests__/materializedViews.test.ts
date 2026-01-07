import { ColumnMeta } from '@hyperdx/common-utils/dist/clickhouse';
import {
  Metadata,
  TableConnection,
  TableMetadata,
} from '@hyperdx/common-utils/dist/core/metadata';

import { getMetadata } from '@/metadata';

import {
  getSourceTableColumn,
  inferMaterializedViewConfig,
  inferTimestampColumnGranularity,
  parseSummedColumns,
} from '../materializedViews';

jest.mock('@/metadata', () => {
  return {
    getMetadata: jest.fn(),
  };
});

function createMockColumnMeta({
  name,
  type,
}: {
  name: string;
  type: string;
}): ColumnMeta {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return { name, type } as ColumnMeta;
}

describe('inferMaterializedViewConfig', () => {
  const mockGetMetadata = jest.mocked(getMetadata);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const mockMetadata: Metadata = {
    getColumns: jest.fn(),
    getTableMetadata: jest.fn(),
    queryMaterializedViewsByTarget: jest.fn(),
  } as unknown as Metadata;

  const mvTargetTable = {
    columns: [
      createMockColumnMeta({ name: 'Timestamp', type: 'DateTime' }),
      createMockColumnMeta({
        name: 'ServiceName',
        type: 'LowCardinality(String)',
      }),
      createMockColumnMeta({
        name: 'SpanKind',
        type: 'LowCardinality(String)',
      }),
      createMockColumnMeta({
        name: 'count',
        type: 'SimpleAggregateFunction(sum, UInt64)',
      }),
      createMockColumnMeta({
        name: 'sum__Duration',
        type: 'SimpleAggregateFunction(sum, UInt64)',
      }),
      createMockColumnMeta({
        name: 'histogram__Duration',
        type: 'AggregateFunction(histogram(20), UInt64)',
      }),
      createMockColumnMeta({
        name: 'quantile__Duration',
        type: 'AggregateFunction(quantile(0.5), UInt64)',
      }),
    ] as ColumnMeta[],
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    meta: {
      engine: 'AggregatingMergeTree',
      database: 'test_db',
      name: 'test_mv_target_table',
      primary_key: 'Timestamp, ServiceName, SpanKind',
    } as unknown as TableMetadata,
  };

  const mvTargetTableSummingMergeTree = {
    columns: [
      createMockColumnMeta({ name: 'Timestamp', type: 'DateTime' }),
      createMockColumnMeta({
        name: 'ServiceName',
        type: 'LowCardinality(String)',
      }),
      createMockColumnMeta({
        name: 'SpanKind',
        type: 'LowCardinality(String)',
      }),
      createMockColumnMeta({
        name: 'quantileDuration',
        type: 'AggregateFunction(quantile(0.5), UInt64)',
      }),
      createMockColumnMeta({
        name: 'count',
        type: 'UInt64',
      }),
      createMockColumnMeta({
        name: 'sumDuration',
        type: 'UInt64',
      }),
    ] as ColumnMeta[],
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    meta: {
      engine: 'SummingMergeTree',
      engine_full:
        'SummingMergeTree((count, sumDuration)) ORDER BY (Timestamp, ServiceName, SpanKind) SETTINGS index_granularity = 8192',
      database: 'test_db',
      name: 'test_mv_target_table_summing',
      primary_key: 'Timestamp, ServiceName, SpanKind',
    } as unknown as TableMetadata,
  };

  const mvSourceTable = {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    columns: [
      { name: 'Timestamp', type: 'DateTime' },
      { name: 'ServiceName', type: 'LowCardinality(String)' },
      { name: 'SpanKind', type: 'LowCardinality(String)' },
      { name: 'Duration', type: 'UInt64' },
    ] as ColumnMeta[],
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    meta: {
      engine: 'SharedMergeTree',
      database: 'test_db',
      name: 'test_source_table',
    } as unknown as TableMetadata,
  };

  const mv = {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    meta: {
      engine: 'MaterializedView',
      database: 'test_db',
      name: 'test_mv',
      create_table_query: `CREATE MATERIALIZED VIEW test_db.test_mv TO test_db.test_mv_target_table AS 
          SELECT toStartOfHour(Timestamp) AS Timestamp, ServiceName, SpanKind, 
            count(*) AS count, sum(Duration) AS sum__Duration, histogram(20)(Duration) as histogram__Duration, quantileState(0.5)(Duration) AS quantile__Duration
          FROM test_source_table
          GROUP BY Timestamp, ServiceName, SpanKind`,
      as_select: `SELECT toStartOfHour(Timestamp) AS Timestamp, ServiceName, SpanKind, 
            count(*) AS count, sum(Duration) AS sum__Duration, histogram(20)(Duration) as histogram__Duration, quantileState(0.5)(Duration) AS quantile__Duration
          FROM test_source_table
          GROUP BY Timestamp, ServiceName, SpanKind`,
    } as unknown as TableMetadata,
  };

  const summingMergeTreeMV = {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    meta: {
      engine: 'MaterializedView',
      database: 'test_db',
      name: 'test_mv_summing',
      create_table_query: `CREATE MATERIALIZED VIEW test_db.test_mv_summing TO test_db.test_mv_target_table_summing AS 
          SELECT toStartOfHour(Timestamp) AS Timestamp, ServiceName, SpanKind, count() AS count, sum(Duration) AS sumDuration, quantileState(0.5)(Duration) AS quantileDuration
          FROM test_source_table
          GROUP BY Timestamp, ServiceName, SpanKind`,
      as_select: `SELECT toStartOfHour(Timestamp) AS Timestamp, ServiceName, SpanKind, count() AS count, sum(Duration) AS sumDuration, quantileState(0.5)(Duration) AS quantileDuration
          FROM test_source_table
          GROUP BY Timestamp, ServiceName, SpanKind`,
    } as unknown as TableMetadata,
  };

  beforeEach(() => {
    mockGetMetadata.mockReturnValue(mockMetadata);
    mockMetadata.getTableMetadata = jest
      .fn()
      .mockImplementation(({ tableName }) => {
        if (tableName === 'test_mv') {
          return Promise.resolve(mv.meta);
        } else if (tableName === 'test_mv_summing') {
          return Promise.resolve(summingMergeTreeMV.meta);
        } else if (tableName === 'test_mv_target_table') {
          return Promise.resolve(mvTargetTable.meta);
        } else if (tableName === 'test_mv_target_table_summing') {
          return Promise.resolve(mvTargetTableSummingMergeTree.meta);
        } else if (tableName === 'test_source_table') {
          return Promise.resolve(mvSourceTable.meta);
        }
        return Promise.reject(new Error(`Table ${tableName} not found`));
      });
    mockMetadata.getColumns = jest.fn().mockImplementation(({ tableName }) => {
      if (tableName === 'test_source_table') {
        return Promise.resolve(mvSourceTable.columns);
      } else if (tableName === 'test_mv_target_table') {
        return Promise.resolve(mvTargetTable.columns);
      } else if (tableName === 'test_mv_target_table_summing') {
        return Promise.resolve(mvTargetTableSummingMergeTree.columns);
      }
      return Promise.reject(new Error(`Table ${tableName} not found`));
    });

    mockMetadata.queryMaterializedViewsByTarget = jest
      .fn()
      .mockImplementation(({ tableName }) => {
        return Promise.resolve([
          {
            databaseName: 'test_db',
            tableName:
              tableName === 'test_mv_target_table_summing'
                ? 'test_mv_summing'
                : 'test_mv',
          },
        ]);
      });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should infer materialized view configuration when given the name of a materialized view target table', async () => {
    const sourceTableConnection: TableConnection = {
      databaseName: 'test_db',
      tableName: 'test_source_table',
      connectionId: 'test_connection',
    };

    const mvTableConnection: TableConnection = {
      databaseName: 'test_db',
      tableName: 'test_mv_target_table',
      connectionId: 'test_connection',
    };

    const actualConfig = await inferMaterializedViewConfig(
      mvTableConnection,
      sourceTableConnection,
    );

    expect(actualConfig).toEqual({
      databaseName: 'test_db',
      tableName: 'test_mv_target_table',
      dimensionColumns: 'ServiceName, SpanKind',
      timestampColumn: 'Timestamp',
      minGranularity: '1 hour',
      aggregatedColumns: [
        {
          aggFn: 'count',
          mvColumn: 'count',
          sourceColumn: '',
        },
        {
          aggFn: 'sum',
          mvColumn: 'sum__Duration',
          sourceColumn: 'Duration',
        },
        {
          aggFn: 'histogram',
          mvColumn: 'histogram__Duration',
          sourceColumn: 'Duration',
        },
        {
          aggFn: 'quantile',
          mvColumn: 'quantile__Duration',
          sourceColumn: 'Duration',
        },
      ],
    });
  });

  it('should infer materialized view configuration when given the name of a materialized view', async () => {
    const sourceTableConnection: TableConnection = {
      databaseName: 'test_db',
      tableName: 'test_source_table',
      connectionId: 'test_connection',
    };

    const mvTableConnection: TableConnection = {
      databaseName: 'test_db',
      tableName: 'test_mv', // Same as the previous test except this line refers to the MV instead of the target table
      connectionId: 'test_connection',
    };

    const actualConfig = await inferMaterializedViewConfig(
      mvTableConnection,
      sourceTableConnection,
    );

    expect(actualConfig).toEqual({
      databaseName: 'test_db',
      tableName: 'test_mv_target_table',
      dimensionColumns: 'ServiceName, SpanKind',
      timestampColumn: 'Timestamp',
      minGranularity: '1 hour',
      aggregatedColumns: [
        {
          aggFn: 'count',
          mvColumn: 'count',
          sourceColumn: '',
        },
        {
          aggFn: 'sum',
          mvColumn: 'sum__Duration',
          sourceColumn: 'Duration',
        },
        {
          aggFn: 'histogram',
          mvColumn: 'histogram__Duration',
          sourceColumn: 'Duration',
        },
        {
          aggFn: 'quantile',
          mvColumn: 'quantile__Duration',
          sourceColumn: 'Duration',
        },
      ],
    });
  });

  it('should infer materialized view configuration when given the name of a SummingMergeTree target table', async () => {
    const sourceTableConnection: TableConnection = {
      databaseName: 'test_db',
      tableName: 'test_source_table',
      connectionId: 'test_connection',
    };

    const mvTableConnection: TableConnection = {
      databaseName: 'test_db',
      tableName: 'test_mv_target_table_summing',
      connectionId: 'test_connection',
    };

    const actualConfig = await inferMaterializedViewConfig(
      mvTableConnection,
      sourceTableConnection,
    );

    expect(actualConfig).toEqual({
      databaseName: 'test_db',
      tableName: 'test_mv_target_table_summing',
      dimensionColumns: 'ServiceName, SpanKind',
      timestampColumn: 'Timestamp',
      minGranularity: '1 hour',
      aggregatedColumns: [
        {
          aggFn: 'quantile',
          mvColumn: 'quantileDuration',
          sourceColumn: 'Duration',
        },
        {
          aggFn: 'count',
          mvColumn: 'count',
          sourceColumn: '',
        },
        {
          aggFn: 'sum',
          mvColumn: 'sumDuration',
          sourceColumn: 'Duration',
        },
      ],
    });
  });

  it('should return a partial result when multiple materialized views target the same table', async () => {
    mockMetadata.queryMaterializedViewsByTarget = jest.fn().mockResolvedValue([
      { tableName: 'test_mv', databaseName: 'test_db' },
      { tableName: 'test_mv_2', databaseName: 'test_db' },
    ]);

    const sourceTableConnection: TableConnection = {
      databaseName: 'test_db',
      tableName: 'test_source_table',
      connectionId: 'test_connection',
    };

    const mvTableConnection: TableConnection = {
      databaseName: 'test_db',
      tableName: 'test_mv_target_table',
      connectionId: 'test_connection',
    };

    const actualConfig = await inferMaterializedViewConfig(
      mvTableConnection,
      sourceTableConnection,
    );

    expect(actualConfig).toEqual({
      databaseName: 'test_db',
      tableName: 'test_mv_target_table',
      dimensionColumns: 'ServiceName, SpanKind',
      timestampColumn: 'Timestamp',
      minGranularity: '', // Since we don't know the MV, we can't infer the granularity
      aggregatedColumns: [
        {
          aggFn: 'count',
          mvColumn: 'count',
          sourceColumn: '',
        },
        {
          aggFn: 'sum',
          mvColumn: 'sum__Duration',
          sourceColumn: 'Duration',
        },
        {
          aggFn: 'histogram',
          mvColumn: 'histogram__Duration',
          sourceColumn: 'Duration',
        },
        {
          aggFn: 'quantile',
          mvColumn: 'quantile__Duration',
          sourceColumn: 'Duration',
        },
      ],
    });
  });

  it('should return undefined when the target table is not an AggregatingMergeTree', async () => {
    const sourceTableConnection: TableConnection = {
      databaseName: 'test_db',
      tableName: 'test_source_table',
      connectionId: 'test_connection',
    };

    const mvTableConnection: TableConnection = {
      databaseName: 'test_db',
      tableName: 'test_source_table', // This table is not an AggregatingMergeTree
      connectionId: 'test_connection',
    };

    const actualConfig = await inferMaterializedViewConfig(
      mvTableConnection,
      sourceTableConnection,
    );

    expect(actualConfig).toBeUndefined();
  });
});

describe('inferTimestampColumnGranularity', () => {
  it.each([
    {
      expected: '1 second',
      asSelect:
        'SELECT toStartOfSecond(Timestamp) AS Timestamp, ServiceName, quantileState(0.9)(Duration) AS p90__Duration FROM default.otel_traces GROUP BY Timestamp, ServiceName',
    },
    {
      expected: '1 minute',
      asSelect:
        'SELECT toStartOfMinute(Timestamp) AS Timestamp, ServiceName, quantileState(0.9)(Duration) AS p90__Duration FROM default.otel_traces GROUP BY Timestamp, ServiceName',
    },
    {
      expected: '5 minute',
      asSelect:
        'SELECT toStartOfFiveMinutes(Timestamp) AS Timestamp, ServiceName, quantileState(0.9)(Duration) AS p90__Duration FROM default.otel_traces GROUP BY Timestamp, ServiceName',
    },
    {
      expected: '15 minute',
      asSelect:
        'SELECT toStartOfFifteenMinutes(Timestamp) AS Timestamp, ServiceName, quantileState(0.9)(Duration) AS p90__Duration FROM default.otel_traces GROUP BY Timestamp, ServiceName',
    },
    {
      expected: '1 hour',
      asSelect:
        'SELECT toStartOfHour(Timestamp) AS Timestamp, ServiceName, quantileState(0.9)(Duration) AS p90__Duration FROM default.otel_traces GROUP BY Timestamp, ServiceName',
    },
    {
      expected: '1 day',
      asSelect:
        'SELECT toStartOfDay(Timestamp) AS Timestamp, ServiceName, quantileState(0.9)(Duration) AS p90__Duration FROM default.otel_traces GROUP BY Timestamp, ServiceName',
    },
  ])(
    'should handle a toStartOfX function with granularity: $expected',
    ({ asSelect, expected }) => {
      expect(
        inferTimestampColumnGranularity(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          {
            as_select: asSelect,
          } as unknown as TableMetadata,
          'Timestamp',
        ),
      ).toBe(expected);
    },
  );

  it.each([
    {
      expected: '1 second',
      asSelect:
        'SELECT toStartOfInterval(Timestamp, INTERVAL 1 SECOND) AS Timestamp, ServiceName, quantileState(0.9)(Duration) AS p90__Duration FROM default.otel_traces GROUP BY Timestamp, ServiceName',
    },
    {
      expected: '5 minute',
      asSelect:
        'SELECT toStartOfInterval(Timestamp, interval 5 minutes) AS Timestamp, ServiceName, quantileState(0.9)(Duration) AS p90__Duration FROM default.otel_traces GROUP BY Timestamp, ServiceName',
    },
    {
      expected: '30 minute',
      asSelect:
        'SELECT toStartOfInterval(Timestamp, toIntervalMinute(30)) AS Timestamp, ServiceName, quantileState(0.9)(Duration) AS p90__Duration FROM default.otel_traces GROUP BY Timestamp, ServiceName',
    },
  ])(
    'should handle a toStartOfInterval function with a dynamic interval: $expected',
    ({ asSelect, expected }) => {
      expect(
        inferTimestampColumnGranularity(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          {
            as_select: asSelect,
          } as unknown as TableMetadata,
          'Timestamp',
        ),
      ).toBe(expected);
    },
  );

  it('should handle toDate()', () => {
    expect(
      inferTimestampColumnGranularity(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        {
          as_select:
            'SELECT toDate(Timestamp) AS Timestamp, ServiceName, quantileState(0.9)(Duration) AS p90__Duration FROM default.otel_traces GROUP BY Timestamp, ServiceName',
        } as unknown as TableMetadata,
        'Timestamp',
      ),
    ).toBe('1 day');
  });

  it('should handle toDateTime()', () => {
    expect(
      inferTimestampColumnGranularity(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        {
          as_select:
            'SELECT toDateTime(Timestamp) AS Timestamp, ServiceName, quantileState(0.9)(Duration) AS p90__Duration FROM default.otel_traces GROUP BY Timestamp, ServiceName',
        } as unknown as TableMetadata,
        'Timestamp',
      ),
    ).toBe('1 second');
  });

  it('should reject non-standard granularities', () => {
    expect(
      inferTimestampColumnGranularity(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        {
          as_select:
            'SELECT toStartOfInterval(Timestamp, INTERVAL 7 SECOND) AS Timestamp, ServiceName, quantileState(0.9)(Duration) AS p90__Duration FROM default.otel_traces GROUP BY Timestamp, ServiceName',
        } as unknown as TableMetadata,
        'Timestamp',
      ),
    ).toBeUndefined();
  });
});

describe('parseSummedColumns', () => {
  it('should parse summed columns correctly when there is one summed column', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const metadata: TableMetadata = {
      engine: 'SummingMergeTree',
      engine_full:
        'SummingMergeTree(count) ORDER BY (Timestamp, ServiceName, SpanKind) SETTINGS index_granularity = 8192',
    } as TableMetadata;

    const parsed = parseSummedColumns(metadata);
    expect(parsed).toEqual(new Set(['count']));
  });

  it('should parse summed columns correctly when there are multiple summed columns', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const metadata = {
      engine: 'SummingMergeTree',
      engine_full:
        'SummingMergeTree((count, sum__Duration)) ORDER BY (Timestamp, ServiceName, SpanKind) SETTINGS index_granularity = 8192',
    } as TableMetadata;

    const parsed = parseSummedColumns(metadata);
    expect(parsed).toEqual(new Set(['count', 'sum__Duration']));
  });
});

describe('getSourceTableColumn', () => {
  it('should return empty string if no matching source column is found', () => {
    const sourceTableColumns: ColumnMeta[] = [
      createMockColumnMeta({ name: 'Duration', type: 'UInt64' }),
      createMockColumnMeta({ name: 'Value', type: 'UInt64' }),
    ];

    const targetTableColumn = createMockColumnMeta({
      name: 'sum__NonExistentColumn',
      type: 'SimpleAggregateFunction(sum, UInt64)',
    });
    const sourceColumn = getSourceTableColumn(
      'sum',
      targetTableColumn,
      sourceTableColumns,
    );
    expect(sourceColumn).toBe('');
  });

  it('should return empty string if the aggFn is count', () => {
    const sourceTableColumns: ColumnMeta[] = [
      createMockColumnMeta({ name: 'Duration', type: 'UInt64' }),
      createMockColumnMeta({ name: 'Value', type: 'UInt64' }),
    ];

    const targetTableColumn = createMockColumnMeta({
      name: 'count',
      type: 'SimpleAggregateFunction(count, UInt64)',
    });
    const sourceColumn = getSourceTableColumn(
      'count',
      targetTableColumn,
      sourceTableColumns,
    );
    expect(sourceColumn).toBe('');
  });

  it('should match source columns based on convention', () => {
    const sourceTableColumns: ColumnMeta[] = [
      createMockColumnMeta({ name: 'Duration', type: 'UInt64' }),
      createMockColumnMeta({ name: 'Value', type: 'UInt64' }),
    ];

    const targetTableColumnSum = createMockColumnMeta({
      name: 'sum__Duration',
      type: 'SimpleAggregateFunction(sum, UInt64)',
    });
    const sourceColumnForSum = getSourceTableColumn(
      'sum',
      targetTableColumnSum,
      sourceTableColumns,
    );
    expect(sourceColumnForSum).toBe('Duration');
  });

  it('should match source column based on MV DDL expressions', () => {
    const sourceTableColumns: ColumnMeta[] = [
      createMockColumnMeta({ name: 'Duration', type: 'UInt64' }),
      createMockColumnMeta({ name: 'Value', type: 'UInt64' }),
    ];

    const targetTableColumnQuantile = createMockColumnMeta({
      name: 'quantileDuration',
      type: 'AggregateFunction(quantile(0.5), UInt64)',
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const mvMetadata: TableMetadata = {
      as_select:
        'SELECT toStartOfHour(Timestamp) AS Timestamp, ServiceName, SpanKind, count() AS count, sum(Duration) AS sumDuration, quantileState(0.5)(Duration) AS quantileDuration FROM test_source_table GROUP BY Timestamp, ServiceName, SpanKind',
    } as unknown as TableMetadata;

    const sourceColumnForQuantile = getSourceTableColumn(
      'quantile',
      targetTableColumnQuantile,
      sourceTableColumns,
      mvMetadata,
    );

    expect(sourceColumnForQuantile).toBe('Duration');
  });

  it('should match source column based on MV DDL expressions when there are overlapping source column names', () => {
    const sourceTableColumns: ColumnMeta[] = [
      createMockColumnMeta({ name: 'MaxDuration', type: 'UInt64' }),
      createMockColumnMeta({ name: 'Duration', type: 'UInt64' }),
      createMockColumnMeta({ name: 'Value', type: 'UInt64' }),
    ];

    const targetTableColumnMaxMax = createMockColumnMeta({
      name: 'maxMaxDuration',
      type: 'AggregateFunction(max, UInt64)',
    });

    const targetTableColumnMax = createMockColumnMeta({
      name: 'maxDuration',
      type: 'AggregateFunction(max, UInt64)',
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const mvMetadata: TableMetadata = {
      as_select:
        'SELECT toStartOfHour(Timestamp) AS Timestamp, ServiceName, SpanKind, count() AS count, max(MaxDuration) AS maxMaxDuration, max(Duration) AS maxDuration FROM test_source_table GROUP BY Timestamp, ServiceName, SpanKind',
    } as unknown as TableMetadata;

    const sourceColumnForMax = getSourceTableColumn(
      'max',
      targetTableColumnMax,
      sourceTableColumns,
      mvMetadata,
    );

    expect(sourceColumnForMax).toBe('Duration');

    const sourceColumnForMaxMax = getSourceTableColumn(
      'max',
      targetTableColumnMaxMax,
      sourceTableColumns,
      mvMetadata,
    );

    expect(sourceColumnForMaxMax).toBe('MaxDuration');
  });
});
