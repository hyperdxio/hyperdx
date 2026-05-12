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
import type { ExternalDashboardTileWithId } from '@/utils/zod';

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
              groupBy: 'SpanName',
              groupByColumnsOnLeft: true,
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

      const tableTile = output.tiles.find(
        (t: { name: string }) => t.name === 'Table',
      );
      expect(tableTile).toBeDefined();
      expect(tableTile.config.groupByColumnsOnLeft).toBe(true);
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

    it.each([
      { output: 'duration', factor: 1e-9 },
      { output: 'data_rate' },
      { output: 'throughput' },
    ] as const)(
      'should round-trip numberFormat output "$output" through save and get',
      async numberFormat => {
        const sourceId = traceSource._id.toString();

        const saveResult = await callTool(client, 'hyperdx_save_dashboard', {
          name: `NumberFormat ${numberFormat.output}`,
          tiles: [
            {
              name: 'Number Tile',
              config: {
                displayType: 'number',
                sourceId,
                select: [{ aggFn: 'count' }],
                numberFormat,
              },
            },
            {
              name: 'Line Tile',
              config: {
                displayType: 'line',
                sourceId,
                select: [
                  { aggFn: 'count' },
                  {
                    aggFn: 'avg',
                    valueExpression: 'Duration',
                    numberFormat,
                  },
                ],
              },
            },
          ],
        });

        expect(saveResult.isError).toBeFalsy();
        const saved = JSON.parse(getFirstText(saveResult));

        const getResult = await callTool(client, 'hyperdx_get_dashboard', {
          id: saved.id,
        });
        expect(getResult.isError).toBeFalsy();
        const fetched = JSON.parse(getFirstText(getResult));

        const numberTile = fetched.tiles.find(
          (t: { name: string }) => t.name === 'Number Tile',
        );
        expect(numberTile.config.numberFormat).toEqual(numberFormat);

        const lineTile = fetched.tiles.find(
          (t: { name: string }) => t.name === 'Line Tile',
        );
        expect(lineTile.config.select[1].numberFormat).toEqual(numberFormat);
      },
    );

    it('should reject numberFormat with an unknown output value', async () => {
      const sourceId = traceSource._id.toString();
      const result = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'Bad NumberFormat',
        tiles: [
          {
            name: 'Number Tile',
            config: {
              displayType: 'number',
              sourceId,
              select: [{ aggFn: 'count' }],
              numberFormat: { output: 'not_a_real_output' },
            },
          },
        ],
      });

      expect(result.isError).toBe(true);
    });
  });

  describe('hyperdx_save_dashboard - containers and tabs', () => {
    // Mirrors the v2 external-API "Containers and tabs" describe block so
    // the MCP path enforces the same 5 cross-field rules: container id
    // unique, tab id unique within a container, tile.containerId
    // resolves, tile.tabId resolves to a tab on that container, and
    // tile.tabId requires tile.containerId.
    const buildTile = (
      sourceId: string,
      overrides: Record<string, unknown>,
    ) => ({
      name: 'Tile',
      x: 0,
      y: 0,
      w: 6,
      h: 3,
      config: {
        displayType: 'line' as const,
        sourceId,
        select: [{ aggFn: 'count' as const, where: '' }],
      },
      ...overrides,
    });

    it('should round-trip containers, tabs, and tile containerId/tabId on create and update', async () => {
      const sourceId = traceSource._id.toString();
      const containers = [
        {
          id: 'service-health',
          title: 'Service Health',
          collapsed: false,
          collapsible: true,
          bordered: true,
          tabs: [
            { id: 'errors', title: 'Errors' },
            { id: 'latency', title: 'Latency' },
          ],
        },
        {
          id: 'overview',
          title: 'Overview',
          collapsed: true,
        },
      ];

      const createResult = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'Containers MCP Round-Trip',
        tiles: [
          buildTile(sourceId, {
            name: 'In Group, Tab A',
            containerId: 'service-health',
            tabId: 'errors',
          }),
          buildTile(sourceId, {
            name: 'In Group, Tab B',
            containerId: 'service-health',
            tabId: 'latency',
          }),
          // Tile inside a tabbed container without a tabId — renders in
          // the container shell rather than under a tab. Guards that the
          // schema does not accidentally require tabId for every tile in
          // a tabbed container.
          buildTile(sourceId, {
            name: 'In Tabbed Group, No Tab',
            containerId: 'service-health',
          }),
          buildTile(sourceId, {
            name: 'In Plain Group',
            containerId: 'overview',
          }),
          buildTile(sourceId, { name: 'Ungrouped' }),
        ],
        tags: ['containers-mcp'],
        containers,
      });

      expect(createResult.isError).toBeFalsy();
      const created = JSON.parse(getFirstText(createResult));
      expect(created.containers).toEqual(containers);

      // Typed as ExternalDashboardTileWithId so a typo on .containerId
      // would fail typecheck instead of silently asserting undefined.
      const createdTilesByName: Record<string, ExternalDashboardTileWithId> =
        Object.fromEntries(
          created.tiles.map((t: ExternalDashboardTileWithId) => [t.name, t]),
        );
      expect(createdTilesByName['In Group, Tab A']).toMatchObject({
        containerId: 'service-health',
        tabId: 'errors',
      });
      expect(createdTilesByName['In Group, Tab B']).toMatchObject({
        containerId: 'service-health',
        tabId: 'latency',
      });
      expect(createdTilesByName['In Tabbed Group, No Tab']).toMatchObject({
        containerId: 'service-health',
      });
      expect(
        createdTilesByName['In Tabbed Group, No Tab'].tabId,
      ).toBeUndefined();
      expect(createdTilesByName['In Plain Group']).toMatchObject({
        containerId: 'overview',
      });
      expect(createdTilesByName['In Plain Group'].tabId).toBeUndefined();
      expect(createdTilesByName.Ungrouped.containerId).toBeUndefined();
      expect(createdTilesByName.Ungrouped.tabId).toBeUndefined();

      // Verify a fresh GET via the get tool also returns the structure.
      const getResult = await callTool(client, 'hyperdx_get_dashboard', {
        id: created.id,
      });
      const fetched = JSON.parse(getFirstText(getResult));
      expect(fetched.containers).toEqual(containers);

      // Update: rename a tab, drop the second container, re-home tiles.
      const updatedContainers = [
        {
          id: 'service-health',
          title: 'Service Health',
          collapsed: true,
          tabs: [
            { id: 'errors', title: 'Error Rate' },
            { id: 'latency', title: 'Latency' },
          ],
        },
      ];
      const reHomedUngrouped = {
        ...createdTilesByName.Ungrouped,
        containerId: 'service-health',
        tabId: 'errors',
      };
      const droppedContainerTile = {
        ...createdTilesByName['In Plain Group'],
        containerId: undefined,
        tabId: undefined,
      };

      const updateResult = await callTool(client, 'hyperdx_save_dashboard', {
        id: created.id,
        name: 'Containers MCP Round-Trip',
        tiles: [
          createdTilesByName['In Group, Tab A'],
          createdTilesByName['In Group, Tab B'],
          createdTilesByName['In Tabbed Group, No Tab'],
          droppedContainerTile,
          reHomedUngrouped,
        ],
        tags: ['containers-mcp'],
        containers: updatedContainers,
      });

      expect(updateResult.isError).toBeFalsy();
      const updated = JSON.parse(getFirstText(updateResult));
      expect(updated.containers).toEqual(updatedContainers);
      const updatedTilesByName: Record<string, ExternalDashboardTileWithId> =
        Object.fromEntries(
          updated.tiles.map((t: ExternalDashboardTileWithId) => [t.name, t]),
        );
      expect(updatedTilesByName['In Plain Group'].containerId).toBeUndefined();
      expect(updatedTilesByName.Ungrouped).toMatchObject({
        containerId: 'service-health',
        tabId: 'errors',
      });
      expect(updatedTilesByName['In Tabbed Group, No Tab'].containerId).toBe(
        'service-health',
      );
      expect(
        updatedTilesByName['In Tabbed Group, No Tab'].tabId,
      ).toBeUndefined();
    });

    it('should reject duplicate container ids', async () => {
      const sourceId = traceSource._id.toString();
      const result = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'Duplicate Container Ids',
        tiles: [buildTile(sourceId, {})],
        containers: [
          { id: 'dupe', title: 'A', collapsed: false },
          { id: 'dupe', title: 'B', collapsed: false },
        ],
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('Container IDs must be unique');
    });

    it('should reject duplicate tab ids within a container', async () => {
      // Structural rules (duplicate container ids, duplicate tab ids) fire
      // through the body schema, which is reported as a stringified issue
      // array. Cross-tile-ref rules (covered below) fire through
      // collectTileContainerRefIssues and produce plain prose.
      const sourceId = traceSource._id.toString();
      const result = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'Duplicate Tab Ids',
        tiles: [buildTile(sourceId, {})],
        containers: [
          {
            id: 'service-health',
            title: 'Service Health',
            collapsed: false,
            tabs: [
              { id: 'errors', title: 'Errors' },
              { id: 'errors', title: 'Errors Two' },
            ],
          },
        ],
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('Duplicate tab id');
      expect(getFirstText(result)).toContain('errors');
      expect(getFirstText(result)).toContain('service-health');
    });

    it('should reject a tile that supplies tabId without containerId', async () => {
      const sourceId = traceSource._id.toString();
      const result = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'Tab Without Container',
        tiles: [buildTile(sourceId, { tabId: 'errors' })],
        containers: [
          {
            id: 'service-health',
            title: 'Service Health',
            collapsed: false,
            tabs: [{ id: 'errors', title: 'Errors' }],
          },
        ],
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain(
        'tabId requires containerId to be set',
      );
    });

    it('should reject a tile that references an unknown containerId', async () => {
      const sourceId = traceSource._id.toString();
      const result = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'Unknown Container',
        tiles: [buildTile(sourceId, { containerId: 'does-not-exist' })],
        containers: [{ id: 'real', title: 'Real', collapsed: false }],
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain(
        'unknown containerId "does-not-exist"',
      );
    });

    it('should reject a tile that references an unknown tabId within a container', async () => {
      const sourceId = traceSource._id.toString();
      const result = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'Unknown Tab',
        tiles: [
          buildTile(sourceId, {
            containerId: 'service-health',
            tabId: 'ghost',
          }),
        ],
        containers: [
          {
            id: 'service-health',
            title: 'Service Health',
            collapsed: false,
            tabs: [{ id: 'errors', title: 'Errors' }],
          },
        ],
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('unknown tabId "ghost"');
    });

    it('should preserve existing containers on update when body omits the field', async () => {
      // Exercises the `effectiveContainers = parsedContainers ?? existingDashboard.containers ?? []`
      // fallback in the MCP update handler. Without it, a PUT that
      // updates only `tiles` would reject because the tile's
      // containerId reference would resolve against an empty array.
      const sourceId = traceSource._id.toString();
      const containers = [
        {
          id: 'service-health',
          title: 'Service Health',
          collapsed: false,
          tabs: [{ id: 'errors', title: 'Errors' }],
        },
      ];
      const createResult = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'PUT-without-containers fallback',
        tiles: [
          buildTile(sourceId, {
            name: 'In Group',
            containerId: 'service-health',
            tabId: 'errors',
          }),
        ],
        containers,
      });
      expect(createResult.isError).toBeFalsy();
      const created = JSON.parse(getFirstText(createResult));

      const updateResult = await callTool(client, 'hyperdx_save_dashboard', {
        id: created.id,
        name: 'PUT-without-containers fallback',
        tiles: created.tiles,
        // containers intentionally omitted
      });
      expect(updateResult.isError).toBeFalsy();
      const updated = JSON.parse(getFirstText(updateResult));
      expect(updated.containers).toEqual(containers);
      expect(updated.tiles[0]).toMatchObject({
        containerId: 'service-health',
        tabId: 'errors',
      });
    });

    it('should wipe persisted containers when update body sets containers: []', async () => {
      // Mirror the v2 behavior: an explicit empty array clears the
      // persisted containers, and the response normalizes [] back to
      // absent on read.
      const sourceId = traceSource._id.toString();
      const createResult = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'Wipe containers',
        tiles: [buildTile(sourceId, { name: 'Tile' })],
        containers: [{ id: 'overview', title: 'Overview', collapsed: false }],
      });
      expect(createResult.isError).toBeFalsy();
      const created = JSON.parse(getFirstText(createResult));
      expect(created.containers).toHaveLength(1);

      const wipedTile = {
        ...created.tiles[0],
        containerId: undefined,
        tabId: undefined,
      };
      const updateResult = await callTool(client, 'hyperdx_save_dashboard', {
        id: created.id,
        name: 'Wipe containers',
        tiles: [wipedTile],
        containers: [],
      });
      expect(updateResult.isError).toBeFalsy();
      const updated = JSON.parse(getFirstText(updateResult));
      expect(updated.containers).toBeUndefined();

      const getResult = await callTool(client, 'hyperdx_get_dashboard', {
        id: created.id,
      });
      const fetched = JSON.parse(getFirstText(getResult));
      expect(fetched.containers).toBeUndefined();
    });

    // Bounds mirror DASHBOARD_CONTAINER_ID_MAX (256) on the tile-level
    // containerId / tabId. 256 chars must accept; 257 must reject.
    // 257 trips the inputSchema's `.max(256)` and surfaces back as the
    // MCP SDK's "Input validation error" envelope.
    it('should accept a 256-char tile.containerId and reject 257', async () => {
      const sourceId = traceSource._id.toString();
      const idAtMax = 'c'.repeat(256);
      const okResult = await callTool(client, 'hyperdx_save_dashboard', {
        name: '256-char containerId',
        tiles: [buildTile(sourceId, { containerId: idAtMax })],
        containers: [{ id: idAtMax, title: 'Max', collapsed: false }],
      });
      expect(okResult.isError).toBeFalsy();

      const idTooLong = 'c'.repeat(257);
      const tooLongResult = await callTool(client, 'hyperdx_save_dashboard', {
        name: '257-char containerId',
        tiles: [buildTile(sourceId, { containerId: idTooLong })],
        containers: [{ id: idTooLong, title: 'Too long', collapsed: false }],
      });
      expect(tooLongResult.isError).toBe(true);
      expect(getFirstText(tooLongResult)).toContain(
        'String must contain at most 256 character(s)',
      );
      expect(getFirstText(tooLongResult)).toContain('containerId');
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
