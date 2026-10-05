import { buildLogComment } from '@hyperdx/common-utils/dist/clickhouse';
import { Metadata } from '@hyperdx/common-utils/dist/core/metadata';

import * as config from '@/config';
import {
  DEFAULT_DATABASE,
  dropTimeSeriesTable,
  getLoggedInAgent,
  getServer,
  getTestFixtureClickHouseClient,
  seedTimeSeriesTagsTable,
} from '@/fixtures';
import Connection from '@/models/connection';

declare global {
  // Set by jest.setup.ts before it stubs `fetch`.
  var realFetch: typeof fetch;
}

// Covers the wiring the unit tests can't: auth middleware opens the
// AsyncLocalStorage scope, and a query issued deep inside the route handler
// still reads it. If that scope is lost, queries fall back to hdx-unknown-*.
describe('request query attribution', () => {
  const server = getServer();
  // Unique per run so query_log rows from earlier runs can't match.
  const TABLE = `query_attribution_${Date.now()}`;

  beforeAll(async () => {
    await server.start();
    await seedTimeSeriesTagsTable({
      table: TABLE,
      series: [
        {
          metricName: 'attribution_metric',
          tags: { job: 'api' },
          startSec: 1700000000,
          endSec: 1700003600,
        },
      ],
      withSamples: true,
    });
  });

  afterEach(async () => {
    await server.clearDBs();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await dropTimeSeriesTable({ table: TABLE });
    await server.stop();
  });

  // query_log is written asynchronously, so flush and poll.
  async function findRouteQueries() {
    const client = await getTestFixtureClickHouseClient();
    for (let attempt = 0; attempt < 10; attempt++) {
      await client.command({ query: 'SYSTEM FLUSH LOGS' });
      const result = await client.query({
        query: `
          SELECT query_id, log_comment
          FROM system.query_log
          WHERE type = 'QueryFinish'
            AND query_kind = 'Select'
            AND position(query, {table:String}) > 0`,
        // Match on the text: timeSeriesTags() reads an inner table, so
        // `tables` lists `.inner_id.tags.<uuid>`, not TABLE.
        query_params: { table: TABLE },
        format: 'JSON',
      });
      const { data }: { data: { query_id: string; log_comment: string }[] } =
        await result.json();
      if (data.length > 0) return data;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return [];
  }

  // As findRouteQueries, for the PromQL evaluation a tile's request ran.
  async function findTileQueries(queryText: string, tile: string) {
    const client = await getTestFixtureClickHouseClient();
    for (let attempt = 0; attempt < 10; attempt++) {
      await client.command({ query: 'SYSTEM FLUSH LOGS' });
      const result = await client.query({
        query: `
          SELECT query_id, log_comment
          FROM system.query_log
          WHERE type = 'QueryFinish'
            AND position(query, {queryText:String}) > 0
            AND JSONExtractString(log_comment, 'tile') = {tile:String}`,
        query_params: { queryText, tile },
        format: 'JSON',
      });
      const { data }: { data: { query_id: string; log_comment: string }[] } =
        await result.json();
      if (data.length > 0) return data;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return [];
  }

  it('tags queries from an authenticated route with the api surface', async () => {
    const { agent, team } = await getLoggedInAgent(server);
    const conn = await Connection.create({
      team: team._id,
      name: 'CH',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });

    await agent
      .get('/v1/prometheus/labels')
      .query({
        connectionId: conn._id.toString(),
        database: DEFAULT_DATABASE,
        table: TABLE,
      })
      .expect(200);

    const logged = await findRouteQueries();
    expect(logged.length).toBeGreaterThan(0);
    for (const row of logged) {
      expect(row.query_id).toMatch(/^hdx-api-/);
      expect(JSON.parse(row.log_comment)).toMatchObject({
        surface: 'api',
        label: '/v1/prometheus',
      });
    }
  });

  it('tags PromQL table-function queries with the attribution the browser sent', async () => {
    // Below 26.6 the router evaluates through prometheusQuery() rather than
    // proxying to ClickHouse's Prometheus HTTP API.
    jest
      .spyOn(Metadata.prototype, 'getServerVersion')
      .mockResolvedValue([26, 5, 0, 0]);
    const { agent, team } = await getLoggedInAgent(server);
    const conn = await Connection.create({
      team: team._id,
      name: 'CH',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
    const tile = `tile-${Date.now()}`;

    await agent
      .get('/v1/prometheus/query')
      .set(
        'x-hyperdx-query-attribution',
        buildLogComment({
          surface: 'dashboard',
          dashboard: 'dash-1',
          tile,
          label: 'from-browser',
          trace: 'from-browser',
        })!,
      )
      .query({
        query: 'attribution_metric',
        time: '1700003600',
        connectionId: conn._id.toString(),
        database: DEFAULT_DATABASE,
        table: TABLE,
      })
      .expect(200);

    const logged = await findTileQueries('prometheusQuery(', tile);

    expect(logged).toHaveLength(1);
    expect(logged[0].query_id).toMatch(/^hdx-dashboard-/);
    expect(JSON.parse(logged[0].log_comment)).toMatchObject({
      surface: 'dashboard',
      dashboard: 'dash-1',
      tile,
      // The server's, not the browser's.
      label: '/v1/prometheus',
    });
    expect(JSON.parse(logged[0].log_comment).trace).not.toBe('from-browser');
  });

  // The CI ClickHouse serves prometheus_api_v1, which evaluates the PromQL
  // itself: this pins that it honours the log_comment and query_id we send.
  it('tags PromQL proxied to the prometheus_api_v1 handler', async () => {
    // A spy, so the afterEach restoreAllMocks puts the stub back.
    jest.spyOn(global, 'fetch').mockImplementation(globalThis.realFetch);
    const { agent, team } = await getLoggedInAgent(server);
    const conn = await Connection.create({
      team: team._id,
      name: 'CH',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
    const tile = `tile-${Date.now()}`;

    await agent
      .get('/v1/prometheus/query')
      .set(
        'x-hyperdx-query-attribution',
        buildLogComment({ surface: 'dashboard', dashboard: 'dash-1', tile })!,
      )
      .query({
        query: 'attribution_metric',
        time: '1700003600',
        connectionId: conn._id.toString(),
        database: DEFAULT_DATABASE,
        table: TABLE,
      })
      .expect(200);

    const logged = await findTileQueries('prometheus_query_step', tile);
    expect(logged).toHaveLength(1);
    expect(logged[0].query_id).toMatch(/^hdx-dashboard-/);
    expect(JSON.parse(logged[0].log_comment)).toMatchObject({
      surface: 'dashboard',
      dashboard: 'dash-1',
      tile,
      label: '/v1/prometheus',
    });
  });
});
