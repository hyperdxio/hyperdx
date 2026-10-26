import { ClickhouseClient } from '@/clickhouse';
import * as config from '@/config';
import { ensureKnowledgeTables, KG_TABLES } from '@/knowledge/tables';

describe('ensureKnowledgeTables', () => {
  const client = new ClickhouseClient({
    host: config.CLICKHOUSE_HOST,
    username: config.CLICKHOUSE_USER,
    password: config.CLICKHOUSE_PASSWORD,
  });

  it('creates the four tables and is idempotent', async () => {
    await ensureKnowledgeTables(client, 'default');
    await ensureKnowledgeTables(client, 'default');

    const result = await client.query({
      query:
        "SELECT name FROM system.tables WHERE database = 'default' AND name LIKE 'hdx_kg_%' ORDER BY name",
      format: 'JSON',
    });
    const rows = (await result.json<{ name: string }>()).data;

    expect(rows.map(r => r.name)).toEqual(Object.values(KG_TABLES).sort());
  });
});
