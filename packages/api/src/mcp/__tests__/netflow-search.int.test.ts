import { createNativeClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { SourceKind } from '@hyperdx/common-utils/dist/types';

import * as config from '@/config';
import { createTeam } from '@/controllers/team';
import { getServer } from '@/fixtures';
import { buildTile, runConfigTile } from '@/mcp/tools/query/helpers';
import Connection from '@/models/connection';
import { NetflowSource } from '@/models/source';
import { runSearchConfig } from '@/routers/external-api/v2/utils/search';

describe('NetFlow bare-term search through MCP and REST query paths', () => {
  const server = getServer();
  const ch = createNativeClient({
    url: config.CLICKHOUSE_HOST,
    username: config.CLICKHOUSE_USER,
    password: config.CLICKHOUSE_PASSWORD,
  });
  const startDate = new Date('2026-01-01T00:00:00Z');
  const endDate = new Date('2026-01-01T01:00:00Z');

  beforeAll(async () => {
    await server.start();
    await ch.command({
      query: `CREATE TABLE default.netflow_search_test (
      timestamp DateTime('UTC'), client IPv6, server IPv6, router Nullable(String),
      src_port UInt16, dst_port UInt16, protocol UInt8, bytes UInt64, packets UInt64,
      search_text String
    ) ENGINE = Memory`,
    });
    await ch.insert({
      table: 'default.netflow_search_test',
      format: 'JSONEachRow',
      values: [
        { router: 'edge-west', bytes: 2000, search_text: 'custom-west' },
        { router: 'edge-east', bytes: 100, search_text: 'custom-east' },
        { router: null, bytes: 3000, search_text: '' },
      ].map(row => ({
        timestamp: '2026-01-01 00:30:00',
        client: '2001:db8::1',
        server: '2001:db8::2',
        src_port: 443,
        dst_port: 50000,
        protocol: 6,
        packets: 2,
        ...row,
      })),
    });
  });
  afterEach(async () => {
    await server.clearDBs();
  });
  afterAll(async () => {
    await ch.command({
      query: 'DROP TABLE IF EXISTS default.netflow_search_test',
    });
    await ch.close();
    await server.stop();
  });

  it.each([
    {
      name: 'fallback exporter mapping',
      implicit: undefined,
      where: 'west AND bytes:[1000 TO *]',
      expected: ['edge-west'],
    },
    {
      name: 'fallback with nullable exporter',
      implicit: undefined,
      where: 'db8 AND bytes:[1000 TO *]',
      expected: ['edge-west', null],
    },
    {
      name: 'custom expression',
      implicit: 'search_text',
      where: 'custom-west AND bytes:[1000 TO *]',
      expected: ['edge-west'],
    },
  ])('supports $name', async ({ implicit, where, expected }) => {
    const team = await createTeam({ name: 'NetFlow search' });
    const connection = await Connection.create({
      team: team._id,
      name: 'Test ClickHouse',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
    const source = await NetflowSource.create({
      kind: SourceKind.Netflow,
      team: team._id,
      connection: connection.id,
      name: 'Custom flows',
      from: { databaseName: 'default', tableName: 'netflow_search_test' },
      timestampValueExpression: 'timestamp',
      defaultTableSelectExpression: 'router, bytes',
      srcAddrExpression: 'client',
      dstAddrExpression: 'server',
      srcPortExpression: 'src_port',
      dstPortExpression: 'dst_port',
      protocolExpression: 'protocol',
      bytesExpression: 'bytes',
      packetsExpression: 'packets',
      exporterExpression: 'router',
      implicitColumnExpression: implicit,
    });
    const query = {
      displayType: 'search' as const,
      select: '',
      sourceId: source.id,
      where,
      whereLanguage: 'lucene' as const,
    };
    const rest = await runSearchConfig({
      teamId: team.id,
      config: query,
      startDate,
      endDate,
      maxResults: 10,
      offset: 0,
    });
    expect(rest.isError).toBe(false);
    if (rest.isError) throw new Error(rest.message);
    expect(rest.data.map(row => row.router)).toEqual(
      expect.arrayContaining(expected),
    );
    expect(rest.data).toHaveLength(expected.length);

    const mcp = await runConfigTile(
      team.id,
      buildTile('Flows', 24, 6, query),
      startDate,
      endDate,
    );
    expect('isError' in mcp && mcp.isError).toBeFalsy();
    const text = mcp.content.find(item => item.type === 'text');
    if (!text || text.type !== 'text') throw new Error('Missing MCP result');
    const rows = JSON.parse(text.text).result.data;
    expect(rows).toHaveLength(expected.length);
    expect(rows.map((row: { router: string | null }) => row.router)).toEqual(
      expect.arrayContaining(expected),
    );
  });
});
