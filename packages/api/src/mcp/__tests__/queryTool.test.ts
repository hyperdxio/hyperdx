import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import * as config from '@/config';
import {
  DEFAULT_DATABASE,
  DEFAULT_TRACES_TABLE,
  getLoggedInAgent,
  getServer,
} from '@/fixtures';
import Connection from '@/models/connection';
import { Source } from '@/models/source';

import { createServer } from '../mcpServer';
import { McpContext } from '../tools/types';

/**
 * Helper to call an MCP tool by name on a connected McpServer.
 * Uses the internal registered handlers directly.
 */
async function callTool(
  server: McpServer,
  toolName: string,
  args: Record<string, unknown> = {},
) {
  const internalServer = (server as any).server;
  const handler = internalServer._requestHandlers?.get('tools/call');
  if (!handler) {
    throw new Error('No tools/call handler registered');
  }
  const result = await handler({
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  });
  return result;
}

describe('MCP Query Tool', () => {
  const server = getServer();
  let team: any;
  let user: any;
  let traceSource: any;
  let connection: any;
  let mcpServer: McpServer;

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    const result = await getLoggedInAgent(server);
    team = result.team;
    user = result.user;

    connection = await Connection.create({
      team: team._id,
      name: 'Default',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });

    traceSource = await Source.create({
      kind: SourceKind.Trace,
      team: team._id,
      from: {
        databaseName: DEFAULT_DATABASE,
        tableName: DEFAULT_TRACES_TABLE,
      },
      timestampValueExpression: 'Timestamp',
      connection: connection._id,
      name: 'Traces',
    });

    const context: McpContext = {
      teamId: team._id.toString(),
      userId: user._id.toString(),
    };
    mcpServer = createServer(context);
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('builder queries', () => {
    it('should execute a number query', async () => {
      const result = await callTool(mcpServer, 'hyperdx_query', {
        displayType: 'number',
        sourceId: traceSource._id.toString(),
        select: [{ aggFn: 'count' }],
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      const output = JSON.parse(result.content[0].text);
      expect(output).toHaveProperty('result');
    });

    it('should execute a line chart query', async () => {
      const result = await callTool(mcpServer, 'hyperdx_query', {
        displayType: 'line',
        sourceId: traceSource._id.toString(),
        select: [{ aggFn: 'count' }],
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
    });

    it('should execute a table query', async () => {
      const result = await callTool(mcpServer, 'hyperdx_query', {
        displayType: 'table',
        sourceId: traceSource._id.toString(),
        select: [{ aggFn: 'count' }],
        groupBy: 'SpanName',
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
    });

    it('should execute a pie query', async () => {
      const result = await callTool(mcpServer, 'hyperdx_query', {
        displayType: 'pie',
        sourceId: traceSource._id.toString(),
        select: [{ aggFn: 'count' }],
        groupBy: 'SpanName',
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
    });

    it('should execute a stacked_bar query', async () => {
      const result = await callTool(mcpServer, 'hyperdx_query', {
        displayType: 'stacked_bar',
        sourceId: traceSource._id.toString(),
        select: [{ aggFn: 'count' }],
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
    });

    it('should use default time range when not provided', async () => {
      const result = await callTool(mcpServer, 'hyperdx_query', {
        displayType: 'number',
        sourceId: traceSource._id.toString(),
        select: [{ aggFn: 'count' }],
      });

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
    });

    it('should return result for query with no matching data', async () => {
      // Use a valid column but a value that won't match any data
      const result = await callTool(mcpServer, 'hyperdx_query', {
        displayType: 'number',
        sourceId: traceSource._id.toString(),
        select: [{ aggFn: 'count', where: 'SpanName:z_impossible_value_xyz' }],
        startTime: new Date(Date.now() - 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
    });
  });

  describe('search queries', () => {
    it('should execute a search query', async () => {
      const result = await callTool(mcpServer, 'hyperdx_query', {
        displayType: 'search',
        sourceId: traceSource._id.toString(),
        where: '',
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
    });

    it('should respect maxResults parameter', async () => {
      const result = await callTool(mcpServer, 'hyperdx_query', {
        displayType: 'search',
        sourceId: traceSource._id.toString(),
        maxResults: 10,
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeUndefined();
    });
  });

  describe('SQL queries', () => {
    it('should execute a raw SQL query', async () => {
      const result = await callTool(mcpServer, 'hyperdx_query', {
        displayType: 'sql',
        connectionId: connection._id.toString(),
        sql: 'SELECT 1 AS value',
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
    });

    it('should execute SQL with time macros', async () => {
      const result = await callTool(mcpServer, 'hyperdx_query', {
        displayType: 'sql',
        connectionId: connection._id.toString(),
        sql: `SELECT count() AS cnt FROM ${DEFAULT_DATABASE}.${DEFAULT_TRACES_TABLE} WHERE $__timeFilter(Timestamp) LIMIT 10`,
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
    });
  });

  describe('error handling', () => {
    it('should return error for invalid time range', async () => {
      const result = await callTool(mcpServer, 'hyperdx_query', {
        displayType: 'number',
        sourceId: traceSource._id.toString(),
        select: [{ aggFn: 'count' }],
        startTime: 'invalid-date',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Invalid');
    });
  });
});
