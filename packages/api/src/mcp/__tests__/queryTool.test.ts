import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import * as config from '@/config';
import {
  DEFAULT_DATABASE,
  DEFAULT_TRACES_TABLE,
  getLoggedInAgent,
  getServer,
} from '@/fixtures';
import Connection from '@/models/connection';
import { Source } from '@/models/source';

import { McpContext } from '../tools/types';
import { callTool, createTestClient, getFirstText } from './mcpTestUtils';

describe('MCP Query Tool', () => {
  const server = getServer();
  let team: any;
  let user: any;
  let traceSource: any;
  let connection: any;
  let client: Client;

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
    client = await createTestClient(context);
  });

  afterEach(async () => {
    await client.close();
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('schema serialization', () => {
    it('should expose inputSchema with all expected properties via tools/list', async () => {
      const { tools } = await client.listTools();
      const queryTool = tools.find(t => t.name === 'hyperdx_query');
      expect(queryTool).toBeDefined();

      const schema = queryTool!.inputSchema;
      expect(schema.type).toBe('object');
      expect(schema.properties).toBeDefined();

      // Verify key properties are present (not silently stripped by the SDK)
      const props = Object.keys(schema.properties ?? {});
      expect(props).toContain('displayType');
      expect(props).toContain('sourceId');
      expect(props).toContain('select');
      expect(props).toContain('where');
      expect(props).toContain('sql');
      expect(props).toContain('connectionId');
      expect(props).toContain('startTime');
      expect(props).toContain('endTime');
      expect(props).toContain('groupBy');

      // displayType should be required
      expect(schema.required).toContain('displayType');
    });
  });

  describe('builder queries', () => {
    it('should execute a number query', async () => {
      const result = await callTool(client, 'hyperdx_query', {
        displayType: 'number',
        sourceId: traceSource._id.toString(),
        select: [{ aggFn: 'count' }],
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
      const output = JSON.parse(getFirstText(result));
      expect(output).toHaveProperty('result');
    });

    it('should execute a line chart query', async () => {
      const result = await callTool(client, 'hyperdx_query', {
        displayType: 'line',
        sourceId: traceSource._id.toString(),
        select: [{ aggFn: 'count' }],
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
    });

    it('should execute a table query', async () => {
      const result = await callTool(client, 'hyperdx_query', {
        displayType: 'table',
        sourceId: traceSource._id.toString(),
        select: [{ aggFn: 'count' }],
        groupBy: 'SpanName',
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
    });

    it('should execute a pie query', async () => {
      const result = await callTool(client, 'hyperdx_query', {
        displayType: 'pie',
        sourceId: traceSource._id.toString(),
        select: [{ aggFn: 'count' }],
        groupBy: 'SpanName',
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
    });

    it('should execute a stacked_bar query', async () => {
      const result = await callTool(client, 'hyperdx_query', {
        displayType: 'stacked_bar',
        sourceId: traceSource._id.toString(),
        select: [{ aggFn: 'count' }],
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
    });

    it('should use default time range when not provided', async () => {
      const result = await callTool(client, 'hyperdx_query', {
        displayType: 'number',
        sourceId: traceSource._id.toString(),
        select: [{ aggFn: 'count' }],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
    });

    it('should return result for query with no matching data', async () => {
      const result = await callTool(client, 'hyperdx_query', {
        displayType: 'number',
        sourceId: traceSource._id.toString(),
        select: [{ aggFn: 'count', where: 'SpanName:z_impossible_value_xyz' }],
        startTime: new Date(Date.now() - 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
    });
  });

  describe('search queries', () => {
    it('should execute a search query', async () => {
      const result = await callTool(client, 'hyperdx_query', {
        displayType: 'search',
        sourceId: traceSource._id.toString(),
        where: '',
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
    });

    it('should respect maxResults parameter', async () => {
      const result = await callTool(client, 'hyperdx_query', {
        displayType: 'search',
        sourceId: traceSource._id.toString(),
        maxResults: 10,
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
    });
  });

  describe('SQL queries', () => {
    it('should execute a raw SQL query', async () => {
      const result = await callTool(client, 'hyperdx_query', {
        displayType: 'sql',
        connectionId: connection._id.toString(),
        sql: 'SELECT 1 AS value',
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
    });

    it('should execute SQL with time macros', async () => {
      const result = await callTool(client, 'hyperdx_query', {
        displayType: 'sql',
        connectionId: connection._id.toString(),
        sql: `SELECT count() AS cnt FROM ${DEFAULT_DATABASE}.${DEFAULT_TRACES_TABLE} WHERE $__timeFilter(Timestamp) LIMIT 10`,
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
    });
  });

  describe('error handling', () => {
    it('should return error for invalid time range', async () => {
      const result = await callTool(client, 'hyperdx_query', {
        displayType: 'number',
        sourceId: traceSource._id.toString(),
        select: [{ aggFn: 'count' }],
        startTime: 'invalid-date',
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('Invalid');
    });
  });
});
