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
    expect(result.data.map((row: any) => _.omit(row, ['id', '_created_at'])))
      .toMatchInlineSnapshot(`
Array [
  Object {
    "_host": "509a8b2dea19",
    "_namespace": "",
    "_platform": "nodejs",
    "_service": "hdx-oss-dev-api",
    "_source": "{\\"level\\":\\"info\\",\\"message\\":\\"Initializing ClickHouse...\\"}",
    "bool.names": Array [],
    "bool.values": Array [],
    "end_timestamp": "1970-01-01T00:00:00.000000000Z",
    "number.names": Array [],
    "number.values": Array [],
    "observed_timestamp": "2024-01-06T05:02:16.156579600Z",
    "parent_span_id": "",
    "severity_number": 0,
    "severity_text": "info",
    "span_id": "",
    "span_name": "",
    "string.names": Array [
      "_hdx_body",
      "level",
      "message",
    ],
    "string.values": Array [
      "Initializing ClickHouse...",
      "info",
      "Initializing ClickHouse...",
    ],
    "timestamp": "2024-01-06T05:02:14.214000000Z",
    "trace_id": "",
    "type": "log",
  },
]
`);
  });

  // TODO: test metrics
});
