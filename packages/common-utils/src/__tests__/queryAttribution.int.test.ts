import { ClickHouseClient, createClient } from '@clickhouse/client';

import {
  ClickhouseClient as HdxClickhouseClient,
  withQueryAttribution,
} from '@/clickhouse/node';

/**
 * Proves the attribution actually survives the round trip into ClickHouse.
 *
 * The unit tests assert what the client *sends*; only a real server can
 * confirm that `log_comment` is accepted as a setting and lands verbatim in
 * `system.query_log`, which is the whole point of the feature.
 */
describe('query attribution integration', () => {
  let client: ClickHouseClient;
  let hdxClient: HdxClickhouseClient;

  const host = process.env.CLICKHOUSE_HOST || 'http://localhost:8123';
  const username = process.env.CLICKHOUSE_USER || 'default';
  const password = process.env.CLICKHOUSE_PASSWORD || '';

  beforeAll(() => {
    client = createClient({ url: host, username, password });
    hdxClient = new HdxClickhouseClient({ host, username, password });
  });

  afterAll(async () => {
    await client.close();
    await hdxClient.close();
  });

  /**
   * `system.query_log` is written asynchronously, so a lookup straight after
   * the query usually misses. Flush explicitly, then poll.
   */
  async function findLoggedQuery(queryId: string) {
    for (let attempt = 0; attempt < 10; attempt++) {
      await client.command({ query: 'SYSTEM FLUSH LOGS' });
      const result = await client.query({
        query: `
          SELECT query_id, log_comment
          FROM system.query_log
          WHERE query_id = {queryId:String} AND type = 'QueryFinish'
          LIMIT 1`,
        query_params: { queryId },
        format: 'JSON',
      });
      const { data } = await result.json<{
        query_id: string;
        log_comment: string;
      }>();
      if (data.length > 0) return data[0];
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return undefined;
  }

  it('writes the attribution into system.query_log', async () => {
    const dashboard = `dash-${Date.now()}`;

    const resultSet = await withQueryAttribution(
      {
        surface: 'dashboard',
        dashboard,
        tile: 'tile-42',
      },
      async () => hdxClient.query({ query: 'SELECT 1 AS one', format: 'JSON' }),
    );
    await resultSet.json();

    // The client generates the id, so it is known without reading it back.
    const queryId = resultSet.query_id;
    expect(queryId).toMatch(/^hdx-dashboard-/);

    const logged = await findLoggedQuery(queryId);
    expect(logged).toBeDefined();
    expect(JSON.parse(logged!.log_comment)).toMatchObject({
      v: 1,
      surface: 'dashboard',
      dashboard,
      tile: 'tile-42',
    });
  });

  it('keeps the payload queryable with JSONExtractString', async () => {
    const tile = `tile-${Date.now()}`;

    const resultSet = await withQueryAttribution(
      { surface: 'search', search: 'saved-1', tile },
      async () => hdxClient.query({ query: 'SELECT 2 AS two', format: 'JSON' }),
    );
    await resultSet.json();
    expect(await findLoggedQuery(resultSet.query_id)).toBeDefined();

    // The access pattern an operator would actually use to attribute load.
    const result = await client.query({
      query: `
        SELECT JSONExtractString(log_comment, 'surface') AS surface
        FROM system.query_log
        WHERE JSONExtractString(log_comment, 'tile') = {tile:String}
          AND type = 'QueryFinish'
        LIMIT 1`,
      query_params: { tile },
      format: 'JSON',
    });
    const { data } = await result.json<{ surface: string }>();
    expect(data[0]?.surface).toBe('search');
  });

  it('leaves log_comment empty when nothing is known', async () => {
    const resultSet = await hdxClient.query({
      query: 'SELECT 3 AS three',
      format: 'JSON',
    });
    await resultSet.json();

    const logged = await findLoggedQuery(resultSet.query_id);
    expect(logged).toBeDefined();
    expect(logged!.log_comment).toBe('');
  });
});
