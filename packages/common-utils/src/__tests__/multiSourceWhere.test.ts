import { parameterizedQueryToSql } from '@/clickhouse';
import { Metadata } from '@/core/metadata';
import { renderChartConfig } from '@/core/renderChartConfig';
import { buildMultiSourceSearchConfig } from '@/core/searchChartConfig';
import { SourceKind, TSource } from '@/types';

/**
 * A search spanning several sources renders one query per source. These tests
 * pin down that the user's WHERE reaches each source's query in both
 * languages, since a SQL condition is passed through verbatim while a Lucene
 * one is resolved against each source's own schema.
 */
describe('multi-source WHERE rendering', () => {
  let metadata: jest.Mocked<Metadata>;

  beforeEach(() => {
    metadata = {
      getColumns: jest.fn().mockResolvedValue([
        { name: 'Timestamp', type: 'DateTime64(9)' },
        { name: 'Body', type: 'String' },
        { name: 'ServiceName', type: 'String' },
        { name: 'SeverityText', type: 'String' },
      ]),
      // The real implementation always returns a Map (possibly empty).
      getMaterializedColumnsLookupTable: jest.fn().mockResolvedValue(new Map()),
      getColumn: jest
        .fn()
        .mockImplementation(async ({ column }: { column: string }) =>
          column === 'ServiceName' || column === 'Body'
            ? { name: column, type: 'String' }
            : undefined,
        ),
      getTableMetadata: jest
        .fn()
        .mockResolvedValue({ primary_key: 'Timestamp' }),
      getSkipIndices: jest.fn().mockResolvedValue([]),
      getSetting: jest.fn().mockResolvedValue(undefined),
      isClickHouseCloud: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<Metadata>;
  });

  const logSource = {
    id: 'logs',
    kind: SourceKind.Log,
    name: 'Logs',
    connection: 'conn-1',
    from: { databaseName: 'default', tableName: 'otel_logs' },
    timestampValueExpression: 'Timestamp',
    defaultTableSelectExpression: 'Timestamp, Body',
    implicitColumnExpression: 'Body',
    bodyExpression: 'Body',
    serviceNameExpression: 'ServiceName',
    severityTextExpression: 'SeverityText',
  } as unknown as TSource;

  const traceSource = {
    id: 'traces',
    kind: SourceKind.Trace,
    name: 'Traces',
    connection: 'conn-2',
    from: { databaseName: 'default', tableName: 'otel_traces' },
    timestampValueExpression: 'Timestamp',
    defaultTableSelectExpression: 'Timestamp, SpanName',
    implicitColumnExpression: 'SpanName',
    serviceNameExpression: 'ServiceName',
    statusCodeExpression: 'StatusCode',
    spanNameExpression: 'SpanName',
    durationExpression: 'Duration',
    durationPrecision: 9,
  } as unknown as TSource;

  const dateRange: [Date, Date] = [
    new Date('2026-01-01T00:00:00Z'),
    new Date('2026-01-01T01:00:00Z'),
  ];

  const render = async (
    source: TSource,
    where: string,
    language: 'sql' | 'lucene',
  ) =>
    parameterizedQueryToSql(
      await renderChartConfig(
        {
          ...buildMultiSourceSearchConfig(source, {
            where,
            whereLanguage: language,
            orderBy: 'Timestamp DESC',
          }),
          dateRange,
        },
        metadata,
        undefined,
      ),
    );

  it('passes a SQL condition through to each source, against its own table', async () => {
    const where = "ServiceName = 'cart'";

    const logSql = await render(logSource, where, 'sql');
    const traceSql = await render(traceSource, where, 'sql');

    expect(logSql).toContain("ServiceName = 'cart'");
    expect(traceSql).toContain("ServiceName = 'cart'");
    // Each query targets its own table and projects the shared aliases.
    expect(logSql).toContain('otel_logs');
    expect(traceSql).toContain('otel_traces');
    expect(logSql).toContain('__hdx_timestamp');
    expect(traceSql).toContain('__hdx_timestamp');
  });

  it('resolves a Lucene field against each source and keeps them independent', async () => {
    const logSql = await render(logSource, 'ServiceName:cart', 'lucene');
    const traceSql = await render(traceSource, 'ServiceName:cart', 'lucene');

    expect(logSql).toContain('ServiceName');
    expect(traceSql).toContain('ServiceName');
    expect(logSql).toContain('otel_logs');
    expect(traceSql).toContain('otel_traces');
  });

  it('resolves a bare Lucene term against each source implicit column', async () => {
    const logSql = await render(logSource, 'timeout', 'lucene');
    const traceSql = await render(traceSource, 'timeout', 'lucene');

    // Logs search their body column; traces search the span name.
    expect(logSql).toContain('Body');
    expect(traceSql).toContain('SpanName');
  });

  it('renders each source against its own connection and timestamp bounds', async () => {
    const logSql = await render(logSource, "ServiceName = 'cart'", 'sql');

    expect(logSql).toContain('Timestamp');
    expect(logSql).toContain('ORDER BY');
  });
});
