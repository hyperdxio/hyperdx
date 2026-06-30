import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import * as config from '@/config';
import {
  DEFAULT_DATABASE,
  DEFAULT_TRACES_TABLE,
  getLoggedInAgent,
  getServer,
} from '@/fixtures';
import { createTestClient } from '@/mcp/__tests__/mcpTestUtils';
import { McpContext } from '@/mcp/tools/types';
import Connection from '@/models/connection';
import { Source } from '@/models/source';

/**
 * Shared setup/teardown for all dashboard MCP tool tests.
 *
 * Usage:
 *   const ctx = setupDashboardTests();
 *   // Then access ctx.team, ctx.traceSource, ctx.connection, ctx.client
 */
export function setupDashboardTests() {
  const server = getServer();
  const ctx = {
    server,
    team: null as any,
    user: null as any,
    traceSource: null as any,
    connection: null as any,
    client: null as Client | null,
  };

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    const result = await getLoggedInAgent(server);
    ctx.team = result.team;
    ctx.user = result.user;

    ctx.connection = await Connection.create({
      team: ctx.team._id,
      name: 'Default',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });

    ctx.traceSource = await Source.create({
      kind: SourceKind.Trace,
      team: ctx.team._id,
      from: {
        databaseName: DEFAULT_DATABASE,
        tableName: DEFAULT_TRACES_TABLE,
      },
      timestampValueExpression: 'Timestamp',
      connection: ctx.connection._id,
      name: 'Traces',
    });

    const mcpContext: McpContext = {
      teamId: ctx.team._id.toString(),
      userId: ctx.user._id.toString(),
    };
    ctx.client = await createTestClient(mcpContext);
  });

  afterEach(async () => {
    await ctx.client?.close();
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  return ctx;
}
