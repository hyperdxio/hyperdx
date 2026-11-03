import { ClickHouseClient, createClient } from '@clickhouse/client';
import SqlString from 'sqlstring';

import { parameterizedQueryToSql } from '@/clickhouse';
import { ClickhouseClient as HdxClickhouseClient } from '@/clickhouse/node';
import { Metadata, MetadataCache } from '@/core/metadata';
import { renderChartConfig } from '@/core/renderChartConfig';
import { ChartConfigWithOptDateRange } from '@/types';

// Runs the Map['k'] = 'v' -> has(items, concat(...)) rewrite against a real
// ClickHouse table, so a literal that is escaped differently from the source
// SQL shows up as a missing row rather than a string mismatch in a unit test.
describe('KV items rewrite integration', () => {
  let client: ClickHouseClient;
  let hdxClient: HdxClickhouseClient;
  let metadata: Metadata;

  const DATABASE = 'default';
  const TABLE_NAME = 'kv_items_rewrite_int_test';

  const ROWS: Array<{ Id: number; LogAttributes: Record<string, string> }> = [
    { Id: 1, LogAttributes: { msg: 'plain' } },
    { Id: 2, LogAttributes: { msg: 'say "hi"' } },
    { Id: 3, LogAttributes: { msg: "it's" } },
    { Id: 4, LogAttributes: { msg: 'C:\\temp\\x' } },
    { Id: 5, LogAttributes: { msg: 'line1\nline2' } },
    {
      Id: 6,
      LogAttributes: {
        msg: '["useMetadata.useTableMetadata",{"connectionId":"6a0c3937cc01bdc90179f030"}] data is undefined',
      },
    },
    { Id: 7, LogAttributes: { "k'y": 'v' } },
  ];

  const msgOf = (id: number) => ROWS.find(r => r.Id === id)!.LogAttributes.msg;

  const queryIds = async (where: string) => {
    const config: ChartConfigWithOptDateRange = {
      connection: 'test-connection',
      from: { databaseName: DATABASE, tableName: TABLE_NAME },
      select: 'Id',
      where,
      whereLanguage: 'sql',
      timestampValueExpression: 'Timestamp',
      dateRange: [new Date('2025-01-01'), new Date('2025-01-02')],
      orderBy: 'Id',
    };
    const sql = parameterizedQueryToSql(
      await renderChartConfig(config, metadata, undefined),
    );
    const result = await client.query({ query: sql, format: 'JSONEachRow' });
    const rows = await result.json<{ Id: number }>();
    return { sql, ids: rows.map(r => Number(r.Id)) };
  };

  beforeAll(async () => {
    const host = process.env.CLICKHOUSE_HOST || 'http://localhost:8123';
    const username = process.env.CLICKHOUSE_USER || 'default';
    const password = process.env.CLICKHOUSE_PASSWORD || '';

    client = createClient({ url: host, username, password });
    hdxClient = new HdxClickhouseClient({ host, username, password });

    await client.command({
      query: `CREATE OR REPLACE TABLE ${DATABASE}.${TABLE_NAME} (
        Timestamp DateTime64(9) CODEC(Delta(8), ZSTD(1)),
        Id UInt32,
        LogAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
        LogAttributeItems Array(String) MATERIALIZED
          arrayMap((x) -> concat(x.1, '=', x.2), LogAttributes::Array(Tuple(String, String)))
          CODEC(ZSTD(1)),
        INDEX idx_log_attr_items LogAttributeItems TYPE text(tokenizer = 'array') GRANULARITY 1
      )
      ENGINE = MergeTree
      ORDER BY (Timestamp)`,
    });

    await client.insert({
      table: `${DATABASE}.${TABLE_NAME}`,
      values: ROWS.map(r => ({ ...r, Timestamp: '2025-01-01 12:00:00' })),
      format: 'JSONEachRow',
    });
  });

  beforeEach(() => {
    metadata = new Metadata(hdxClient, new MetadataCache());
  });

  afterAll(async () => {
    await client.command({
      query: `DROP TABLE IF EXISTS ${DATABASE}.${TABLE_NAME}`,
    });
    await hdxClient.close();
    await client.close();
  });

  it.each([
    ['plain value', 1],
    ['double quotes', 2],
    ['single quote', 3],
    ['backslashes', 4],
    ['newline', 5],
    ['JSON with escaped quotes', 6],
  ])('finds the row for Map[key] = value with %s', async (_, id) => {
    const literal = SqlString.escape(msgOf(id));
    const rewritten = await queryIds(`LogAttributes['msg'] = ${literal}`);
    // arrayElement() is not rewritten, so it shows what the filter should match.
    const baseline = await queryIds(
      `arrayElement(LogAttributes, 'msg') = ${literal}`,
    );

    expect(rewritten.sql).toContain('has(`LogAttributeItems`');
    expect(baseline.sql).not.toContain('LogAttributeItems');
    expect(rewritten.ids).toEqual([id]);
    expect(baseline.ids).toEqual([id]);
  });

  it('finds the row for a doubled single quote in the value', async () => {
    const { sql, ids } = await queryIds(`LogAttributes['msg'] = 'it''s'`);
    expect(sql).toContain('has(`LogAttributeItems`');
    expect(ids).toEqual([3]);
  });

  it('finds the rows for Map[key] IN (...) with escaped values', async () => {
    const values = [2, 4, 6].map(id => SqlString.escape(msgOf(id)));
    const { sql, ids } = await queryIds(
      `LogAttributes['msg'] IN (${values.join(', ')})`,
    );
    expect(sql).toContain('hasAny(`LogAttributeItems`');
    expect(ids).toEqual([2, 4, 6]);
  });

  it('finds the row when the map key contains an escaped quote', async () => {
    const { sql, ids } = await queryIds(`LogAttributes['k\\'y'] = 'v'`);
    expect(sql).toContain('has(`LogAttributeItems`');
    expect(ids).toEqual([7]);
  });

  it('finds the row for a side panel rowWhere with JSON in an attribute', async () => {
    const { sql, ids } = await queryIds(
      String.raw`Timestamp = '2025-01-01 12:00:00' AND LogAttributes['msg']='[\"useMetadata.useTableMetadata\",{\"connectionId\":\"6a0c3937cc01bdc90179f030\"}] data is undefined'`,
    );
    expect(sql).toContain('has(`LogAttributeItems`');
    expect(ids).toEqual([6]);
  });
});
