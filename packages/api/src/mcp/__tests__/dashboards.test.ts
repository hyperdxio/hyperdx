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
import Dashboard from '@/models/dashboard';
import { Source } from '@/models/source';

import { McpContext } from '../tools/types';
import { callTool, createTestClient, getFirstText } from './mcpTestUtils';

describe('MCP Dashboard Tools', () => {
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

  describe('hyperdx_list_sources', () => {
    it('should list available sources and connections', async () => {
      const result = await callTool(client, 'hyperdx_list_sources');

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);

      const output = JSON.parse(getFirstText(result));
      expect(output.sources).toHaveLength(1);
      expect(output.sources[0]).toMatchObject({
        id: traceSource._id.toString(),
        name: 'Traces',
        kind: SourceKind.Trace,
      });

      expect(output.connections).toHaveLength(1);
      expect(output.connections[0]).toMatchObject({
        id: connection._id.toString(),
        name: 'Default',
      });

      expect(output.usage).toBeDefined();
    });

    it('should include column schema for sources', async () => {
      const result = await callTool(client, 'hyperdx_list_sources');
      const output = JSON.parse(getFirstText(result));
      const source = output.sources[0];

      expect(source.columns).toBeDefined();
      expect(Array.isArray(source.columns)).toBe(true);
      expect(source.columns.length).toBeGreaterThan(0);
      // Each column should have name, type, and jsType
      expect(source.columns[0]).toHaveProperty('name');
      expect(source.columns[0]).toHaveProperty('type');
      expect(source.columns[0]).toHaveProperty('jsType');
    });

    it('should return empty sources for a team with no sources', async () => {
      // Clear everything and re-register with new team
      await client.close();
      await server.clearDBs();
      const result2 = await getLoggedInAgent(server);
      const context2: McpContext = {
        teamId: result2.team._id.toString(),
      };
      const client2 = await createTestClient(context2);

      const result = await callTool(client2, 'hyperdx_list_sources');
      const output = JSON.parse(getFirstText(result));

      expect(output.sources).toHaveLength(0);
      expect(output.connections).toHaveLength(0);

      await client2.close();
    });
  });

  describe('hyperdx_get_dashboard', () => {
    it('should list all dashboards when no id provided', async () => {
      await new Dashboard({
        name: 'Dashboard 1',
        tiles: [],
        team: team._id,
        tags: ['tag1'],
      }).save();
      await new Dashboard({
        name: 'Dashboard 2',
        tiles: [],
        team: team._id,
        tags: ['tag2'],
      }).save();

      const result = await callTool(client, 'hyperdx_get_dashboard', {});

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output).toHaveLength(2);
      expect(output[0]).toHaveProperty('id');
      expect(output[0]).toHaveProperty('name');
      expect(output[0]).toHaveProperty('tags');
    });

    it('should get dashboard detail when id is provided', async () => {
      const dashboard = await new Dashboard({
        name: 'My Dashboard',
        tiles: [],
        team: team._id,
        tags: ['test'],
      }).save();

      const result = await callTool(client, 'hyperdx_get_dashboard', {
        id: dashboard._id.toString(),
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.id).toBe(dashboard._id.toString());
      expect(output.name).toBe('My Dashboard');
      expect(output.tags).toEqual(['test']);
      expect(output.tiles).toEqual([]);
    });

    it('should return error for non-existent dashboard id', async () => {
      const fakeId = '000000000000000000000000';
      const result = await callTool(client, 'hyperdx_get_dashboard', {
        id: fakeId,
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('not found');
    });
  });

  describe('hyperdx_save_dashboard', () => {
    it('should create a new dashboard with tiles', async () => {
      const sourceId = traceSource._id.toString();
      const result = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'New MCP Dashboard',
        tiles: [
          {
            name: 'Line Chart',
            x: 0,
            y: 0,
            w: 12,
            h: 4,
            config: {
              displayType: 'line',
              sourceId,
              select: [{ aggFn: 'count', where: '' }],
            },
          },
        ],
        tags: ['mcp-test'],
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.id).toBeDefined();
      expect(output.name).toBe('New MCP Dashboard');
      expect(output.tiles).toHaveLength(1);
      expect(output.tiles[0].config.displayType).toBe('line');
      expect(output.tags).toEqual(['mcp-test']);

      // Verify in database
      const dashboard = await Dashboard.findById(output.id);
      expect(dashboard).not.toBeNull();
      expect(dashboard?.name).toBe('New MCP Dashboard');
    });

    it('should create a dashboard with a markdown tile', async () => {
      const result = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'Markdown Dashboard',
        tiles: [
          {
            name: 'Notes',
            config: {
              displayType: 'markdown',
              markdown: '# Hello World',
            },
          },
        ],
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.tiles).toHaveLength(1);
      expect(output.tiles[0].config.displayType).toBe('markdown');
    });

    it('should update an existing dashboard', async () => {
      const sourceId = traceSource._id.toString();

      // Create first
      const createResult = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'Original Name',
        tiles: [
          {
            name: 'Tile 1',
            config: {
              displayType: 'number',
              sourceId,
              select: [{ aggFn: 'count' }],
            },
          },
        ],
      });
      const created = JSON.parse(getFirstText(createResult));

      // Update
      const updateResult = await callTool(client, 'hyperdx_save_dashboard', {
        id: created.id,
        name: 'Updated Name',
        tiles: [
          {
            name: 'Updated Tile',
            config: {
              displayType: 'table',
              sourceId,
              select: [{ aggFn: 'count' }],
            },
          },
        ],
        tags: ['updated'],
      });

      expect(updateResult.isError).toBeFalsy();
      const updated = JSON.parse(getFirstText(updateResult));
      expect(updated.id).toBe(created.id);
      expect(updated.name).toBe('Updated Name');
      expect(updated.tiles).toHaveLength(1);
      expect(updated.tiles[0].name).toBe('Updated Tile');
      expect(updated.tiles[0].config.displayType).toBe('table');
    });

    it('should return error for missing source ID', async () => {
      const fakeSourceId = '000000000000000000000000';
      const result = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'Bad Dashboard',
        tiles: [
          {
            name: 'Bad Tile',
            config: {
              displayType: 'line',
              sourceId: fakeSourceId,
              select: [{ aggFn: 'count' }],
            },
          },
        ],
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('source');
    });

    it('should return error when updating non-existent dashboard', async () => {
      const sourceId = traceSource._id.toString();
      const result = await callTool(client, 'hyperdx_save_dashboard', {
        id: '000000000000000000000000',
        name: 'Ghost Dashboard',
        tiles: [
          {
            name: 'Tile',
            config: {
              displayType: 'line',
              sourceId,
              select: [{ aggFn: 'count' }],
            },
          },
        ],
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('not found');
    });

    it('should create a dashboard with multiple tile types', async () => {
      const sourceId = traceSource._id.toString();
      const result = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'Multi-tile Dashboard',
        tiles: [
          {
            name: 'Line',
            x: 0,
            y: 0,
            w: 12,
            h: 4,
            config: {
              displayType: 'line',
              sourceId,
              select: [{ aggFn: 'count' }],
            },
          },
          {
            name: 'Table',
            x: 0,
            y: 4,
            w: 12,
            h: 4,
            config: {
              displayType: 'table',
              sourceId,
              select: [{ aggFn: 'count' }],
            },
          },
          {
            name: 'Number',
            x: 0,
            y: 8,
            w: 6,
            h: 3,
            config: {
              displayType: 'number',
              sourceId,
              select: [{ aggFn: 'count' }],
            },
          },
          {
            name: 'Pie',
            x: 6,
            y: 8,
            w: 6,
            h: 3,
            config: {
              displayType: 'pie',
              sourceId,
              select: [{ aggFn: 'count' }],
              groupBy: 'SpanName',
            },
          },
          {
            name: 'Notes',
            x: 0,
            y: 11,
            w: 12,
            h: 2,
            config: { displayType: 'markdown', markdown: '# Dashboard Notes' },
          },
        ],
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.tiles).toHaveLength(5);
    });

    it('should create a dashboard with a raw SQL tile', async () => {
      const connectionId = connection._id.toString();
      const result = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'SQL Dashboard',
        tiles: [
          {
            name: 'Raw SQL',
            config: {
              configType: 'sql',
              displayType: 'table',
              connectionId,
              sqlTemplate: 'SELECT 1 AS value LIMIT 1',
            },
          },
        ],
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.tiles).toHaveLength(1);
    });
  });

  describe('hyperdx_delete_dashboard', () => {
    it('should delete an existing dashboard', async () => {
      const dashboard = await new Dashboard({
        name: 'To Delete',
        tiles: [],
        team: team._id,
      }).save();

      const result = await callTool(client, 'hyperdx_delete_dashboard', {
        id: dashboard._id.toString(),
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.deleted).toBe(true);
      expect(output.id).toBe(dashboard._id.toString());

      // Verify deleted from database
      const found = await Dashboard.findById(dashboard._id);
      expect(found).toBeNull();
    });

    it('should return error for non-existent dashboard', async () => {
      const result = await callTool(client, 'hyperdx_delete_dashboard', {
        id: '000000000000000000000000',
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('not found');
    });
  });

  describe('hyperdx_query_tile', () => {
    it('should return error for non-existent dashboard', async () => {
      const result = await callTool(client, 'hyperdx_query_tile', {
        dashboardId: '000000000000000000000000',
        tileId: 'some-tile-id',
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('not found');
    });

    it('should return error for non-existent tile', async () => {
      const sourceId = traceSource._id.toString();
      const createResult = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'Tile Query Test',
        tiles: [
          {
            name: 'My Tile',
            config: {
              displayType: 'number',
              sourceId,
              select: [{ aggFn: 'count' }],
            },
          },
        ],
      });
      const dashboard = JSON.parse(getFirstText(createResult));

      const result = await callTool(client, 'hyperdx_query_tile', {
        dashboardId: dashboard.id,
        tileId: 'non-existent-tile-id',
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('Tile not found');
    });

    it('should return error for invalid time range', async () => {
      const sourceId = traceSource._id.toString();
      const createResult = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'Time Range Test',
        tiles: [
          {
            name: 'Tile',
            config: {
              displayType: 'number',
              sourceId,
              select: [{ aggFn: 'count' }],
            },
          },
        ],
      });
      const dashboard = JSON.parse(getFirstText(createResult));

      const result = await callTool(client, 'hyperdx_query_tile', {
        dashboardId: dashboard.id,
        tileId: dashboard.tiles[0].id,
        startTime: 'not-a-date',
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('Invalid');
    });

    it('should execute query for a valid tile', async () => {
      const sourceId = traceSource._id.toString();
      const createResult = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'Query Tile Test',
        tiles: [
          {
            name: 'Count Tile',
            config: {
              displayType: 'number',
              sourceId,
              select: [{ aggFn: 'count' }],
            },
          },
        ],
      });
      const dashboard = JSON.parse(getFirstText(createResult));

      const result = await callTool(client, 'hyperdx_query_tile', {
        dashboardId: dashboard.id,
        tileId: dashboard.tiles[0].id,
        startTime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      // Should succeed (may have empty results since no data inserted)
      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
    });
  });
});
