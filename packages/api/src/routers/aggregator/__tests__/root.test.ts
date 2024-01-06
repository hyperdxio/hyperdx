import _ from 'lodash';

import * as clickhouse from '@/clickhouse';
import { createTeam } from '@/controllers/team';
import {
  clearClickhouseTables,
  clearDBCollections,
  closeDB,
  getAgent,
  getServer,
} from '@/fixtures';
import { sleep } from '@/utils/common';

describe('aggregator root router', () => {
  const server = getServer('aggregator');

  beforeAll(async () => {
    await server.start();
  });

  afterEach(async () => {
    await clearDBCollections();
    await clearClickhouseTables();
  });

  afterAll(async () => {
    await server.closeHttpServer();
    await closeDB();
  });

  it('GET /health', async () => {
    const agent = await getAgent(server);
    await agent.get('/health').expect(200);
  });

  it('POST / -> should return 400 if no logs', async () => {
    const agent = await getAgent(server);
    await agent.post('/').send({}).expect(400);
  });

  it('POST / -> should ingest logs', async () => {
    const team = await createTeam({ name: 'test-team' });
    const agent = await getAgent(server);
    await agent.post('/').send([
      {
        b: {
          _hdx_body: 'Initializing ClickHouse...',
          level: 'info',
          message: 'Initializing ClickHouse...',
        },
        h: '509a8b2dea19',
        hdx_platform: 'nodejs',
        hdx_token: team.apiKey,
        hdx_token_hash: '2f4da895de6a20c100c28daaa5c07c51',
        path: '/',
        r: { level: 'info', message: 'Initializing ClickHouse...' },
        s_id: null,
        sn: 0,
        st: 'info',
        sv: 'hdx-oss-dev-api',
        t_id: null,
        ts: 1704517334214000000,
        tso: 1704517336156579600,
      },
    ]);

    // wait for data to be committed to clickhouse
    await sleep(500);

    const resp = await clickhouse.client.query({
      query: `SELECT * FROM default.${clickhouse.TableName.LogStream}`,
      format: 'JSON',
    });
    const result: any = await resp.json();
    expect(result.data.length).toBe(1);
    expect(result.data[0]._service).toBe('hdx-oss-dev-api');
    expect(result.data[0]._platform).toBe('nodejs');
    expect(result.data[0].severity_text).toBe('info');
  });

  // TODO: test metrics
});
