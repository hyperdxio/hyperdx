import { MetricsDataType, SourceKind } from '@hyperdx/common-utils/dist/types';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';

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

import {
  buildCreateDashboardPrompt,
  buildDashboardExamplesPrompt,
  buildQueryGuidePrompt,
} from '../prompts/dashboards/content';
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
    await client?.close();
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
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

    it('should create a dashboard with a heatmap tile on a Trace source', async () => {
      const sourceId = traceSource._id.toString();
      const result = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'Heatmap Dashboard',
        tiles: [
          {
            name: 'Latency Heatmap',
            x: 0,
            y: 0,
            w: 12,
            h: 4,
            config: {
              displayType: 'heatmap',
              sourceId,
              select: [
                {
                  valueExpression: 'Duration',
                },
              ],
            },
          },
        ],
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.tiles).toHaveLength(1);
      expect(output.tiles[0].config.displayType).toBe('heatmap');
      expect(output.tiles[0].config.select[0]).toMatchObject({
        valueExpression: 'Duration',
      });
    });

    it('should round-trip every MCP-specific heatmap field through save, get, update, and re-get', async () => {
      const sourceId = traceSource._id.toString();

      const createConfig = {
        displayType: 'heatmap' as const,
        sourceId,
        select: [
          {
            valueExpression: 'Duration',
            countExpression: 'count()',
            heatmapScaleType: 'log' as const,
          },
        ],
        where: 'level:error',
        whereLanguage: 'lucene' as const,
        numberFormat: { output: 'duration' as const, factor: 1e-9 },
      };
      // Mutate select + where on update; numberFormat, whereLanguage,
      // and sourceId carry forward via the spread. Re-asserting against
      // updatedConfig catches a regression where PUT silently drops any
      // carried-forward field.
      const updatedConfig = {
        ...createConfig,
        select: [
          {
            valueExpression: "SpanAttributes['http.duration']",
            heatmapScaleType: 'linear' as const,
          },
        ],
        where: 'level:error AND service:checkout',
      };

      const saveResult = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'Heatmap Full Round-Trip',
        tiles: [
          {
            name: 'Latency Heatmap',
            x: 0,
            y: 0,
            w: 12,
            h: 4,
            config: createConfig,
          },
        ],
      });
      expect(saveResult.isError).toBeFalsy();
      const saved = JSON.parse(getFirstText(saveResult));
      expect(saved.tiles).toHaveLength(1);
      expect(saved.tiles[0].config).toMatchObject(createConfig);

      const getResult = await callTool(client, 'hyperdx_get_dashboard', {
        id: saved.id,
      });
      expect(getResult.isError).toBeFalsy();
      const fetched = JSON.parse(getFirstText(getResult));
      expect(fetched.tiles[0].config).toMatchObject(createConfig);

      const updateResult = await callTool(client, 'hyperdx_save_dashboard', {
        id: saved.id,
        name: 'Heatmap Full Round-Trip',
        tiles: [
          {
            ...fetched.tiles[0],
            config: { ...fetched.tiles[0].config, ...updatedConfig },
          },
        ],
      });
      expect(updateResult.isError).toBeFalsy();
      const updated = JSON.parse(getFirstText(updateResult));
      expect(updated.tiles[0].config).toMatchObject(updatedConfig);

      const getAfterUpdate = await callTool(client, 'hyperdx_get_dashboard', {
        id: saved.id,
      });
      expect(getAfterUpdate.isError).toBeFalsy();
      const refetched = JSON.parse(getFirstText(getAfterUpdate));
      expect(refetched.tiles[0].config).toMatchObject(updatedConfig);
    });

    it('should reject heatmap tile with empty valueExpression at the schema layer', async () => {
      const sourceId = traceSource._id.toString();
      const result = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'Bad Heatmap',
        tiles: [
          {
            name: 'Heatmap',
            config: {
              displayType: 'heatmap',
              sourceId,
              select: [{ valueExpression: '' }],
            },
          },
        ],
      });

      expect(result.isError).toBe(true);
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

    it('should reject heatmap tile on a non-Trace source', async () => {
      // Create a Log source so the heatmap source-kind gate has
      // something to reject. The schema accepts the tile shape (the
      // sourceId is valid), so this exercises the runtime check that
      // the REST POST path also runs.
      const logSource = await Source.create({
        kind: SourceKind.Log,
        team: team._id,
        from: {
          databaseName: DEFAULT_DATABASE,
          tableName: 'otel_logs',
        },
        timestampValueExpression: 'Timestamp',
        connection: connection._id,
        name: 'Logs',
      });

      const result = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'Heatmap on Log Source',
        tiles: [
          {
            name: 'Heatmap',
            config: {
              displayType: 'heatmap',
              sourceId: logSource._id.toString(),
              select: [{ valueExpression: 'Duration' }],
            },
          },
        ],
      });

      expect(result.isError).toBe(true);
      const text = getFirstText(result);
      expect(text).toContain('Trace source');
      expect(text).toContain(logSource._id.toString());
    });

    // Exercises the update-side source-kind gate via filterChangedHeatmapTiles
    // (displayType changed to heatmap on an existing tile).
    it('should reject update that changes a tile to heatmap on a non-Trace source', async () => {
      const logSource = await Source.create({
        kind: SourceKind.Log,
        team: team._id,
        from: { databaseName: DEFAULT_DATABASE, tableName: 'otel_logs' },
        timestampValueExpression: 'Timestamp',
        connection: connection._id,
        name: 'Logs',
      });

      const created = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'Line on Log Source',
        tiles: [
          {
            name: 'Line',
            config: {
              displayType: 'line',
              sourceId: logSource._id.toString(),
              select: [{ aggFn: 'count' }],
            },
          },
        ],
      });
      expect(created.isError).toBeFalsy();
      const saved = JSON.parse(getFirstText(created));

      const update = await callTool(client, 'hyperdx_save_dashboard', {
        id: saved.id,
        name: 'Line on Log Source',
        tiles: [
          {
            ...saved.tiles[0],
            config: {
              ...saved.tiles[0].config,
              displayType: 'heatmap',
              select: [{ valueExpression: 'Duration' }],
            },
          },
        ],
      });
      expect(update.isError).toBe(true);
      const text = getFirstText(update);
      expect(text).toContain('Trace source');
      expect(text).toContain(logSource._id.toString());
    });

    // Exercises the update-side source-kind gate via filterChangedHeatmapTiles
    // (sourceId changed on an existing heatmap tile).
    it('should reject update that changes a heatmap tile source to a non-Trace source', async () => {
      const logSource = await Source.create({
        kind: SourceKind.Log,
        team: team._id,
        from: { databaseName: DEFAULT_DATABASE, tableName: 'otel_logs' },
        timestampValueExpression: 'Timestamp',
        connection: connection._id,
        name: 'Logs',
      });

      const created = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'Heatmap re-pointed at Log',
        tiles: [
          {
            name: 'Heatmap',
            config: {
              displayType: 'heatmap',
              sourceId: traceSource._id.toString(),
              select: [{ valueExpression: 'Duration' }],
            },
          },
        ],
      });
      expect(created.isError).toBeFalsy();
      const saved = JSON.parse(getFirstText(created));

      const update = await callTool(client, 'hyperdx_save_dashboard', {
        id: saved.id,
        name: 'Heatmap re-pointed at Log',
        tiles: [
          {
            ...saved.tiles[0],
            config: {
              ...saved.tiles[0].config,
              sourceId: logSource._id.toString(),
            },
          },
        ],
      });
      expect(update.isError).toBe(true);
      const text = getFirstText(update);
      expect(text).toContain('Trace source');
      expect(text).toContain(logSource._id.toString());
    });

    // Asserts each tile's config survives the serializer/deserializer cycle
    // independently when mixed with other displayTypes on the same dashboard.
    it('should round-trip a heatmap alongside line and number tiles in one dashboard', async () => {
      const sourceId = traceSource._id.toString();

      const heatmapConfig = {
        displayType: 'heatmap' as const,
        sourceId,
        select: [
          { valueExpression: 'Duration', heatmapScaleType: 'log' as const },
        ],
      };
      const lineConfig = {
        displayType: 'line' as const,
        sourceId,
        select: [{ aggFn: 'count' as const }],
        groupBy: "SpanAttributes['service.name']",
      };
      const numberConfig = {
        displayType: 'number' as const,
        sourceId,
        select: [{ aggFn: 'count' as const }],
        numberFormat: { output: 'number' as const, average: true },
      };

      const save = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'Mixed Tile Round-Trip',
        tiles: [
          { name: 'Heatmap Tile', config: heatmapConfig },
          { name: 'Line Tile', config: lineConfig },
          { name: 'Number Tile', config: numberConfig },
        ],
      });
      expect(save.isError).toBeFalsy();
      const saved = JSON.parse(getFirstText(save));
      expect(saved.tiles).toHaveLength(3);

      const byName: Record<string, ExternalDashboardTileWithId> =
        Object.fromEntries(
          saved.tiles.map((t: ExternalDashboardTileWithId) => [t.name, t]),
        );
      expect(byName['Heatmap Tile'].config).toMatchObject(heatmapConfig);
      expect(byName['Line Tile'].config).toMatchObject(lineConfig);
      expect(byName['Number Tile'].config).toMatchObject(numberConfig);

      const fetched = JSON.parse(
        getFirstText(
          await callTool(client, 'hyperdx_get_dashboard', { id: saved.id }),
        ),
      );
      const fetchedByName: Record<string, ExternalDashboardTileWithId> =
        Object.fromEntries(
          fetched.tiles.map((t: ExternalDashboardTileWithId) => [t.name, t]),
        );
      expect(fetchedByName['Heatmap Tile'].config).toMatchObject(heatmapConfig);
      expect(fetchedByName['Line Tile'].config).toMatchObject(lineConfig);
      expect(fetchedByName['Number Tile'].config).toMatchObject(numberConfig);
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
          // Tile inside a tabbed container without a tabId renders in
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

  describe('hyperdx_save_dashboard - table onClick linking', () => {
    // Mirrors the v2 external-API onClick tests so the MCP path
    // enforces the same drill-down rules: row-click can target /search
    // for a log/trace source or another dashboard, by concrete ID or
    // by templated name, with optional whereTemplate/filters.
    it('should round-trip a table tile with a search onClick by ID', async () => {
      const sourceId = traceSource._id.toString();
      const createResult = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'OnClick search by id',
        tiles: [
          {
            name: 'Errors by Service',
            x: 0,
            y: 0,
            w: 12,
            h: 6,
            config: {
              displayType: 'table',
              sourceId,
              groupBy: "ResourceAttributes['service.name']",
              select: [{ aggFn: 'count' }],
              onClick: {
                type: 'search',
                target: { mode: 'id', id: sourceId },
                whereLanguage: 'sql',
                filters: [
                  {
                    kind: 'expressionTemplate',
                    expression: 'ServiceName',
                    template: "{{ResourceAttributes['service.name']}}",
                  },
                ],
              },
            },
          },
        ],
      });

      expect(createResult.isError).toBeFalsy();
      const created = JSON.parse(getFirstText(createResult));
      expect(created.tiles[0].config.onClick).toEqual({
        type: 'search',
        target: { mode: 'id', id: sourceId },
        whereLanguage: 'sql',
        filters: [
          {
            kind: 'expressionTemplate',
            expression: 'ServiceName',
            template: "{{ResourceAttributes['service.name']}}",
          },
        ],
      });

      const getResult = await callTool(client, 'hyperdx_get_dashboard', {
        id: created.id,
      });
      const fetched = JSON.parse(getFirstText(getResult));
      expect(fetched.tiles[0].config.onClick).toEqual(
        created.tiles[0].config.onClick,
      );
    });

    it('should round-trip a table tile with a dashboard onClick by ID', async () => {
      const sourceId = traceSource._id.toString();
      // Create the target dashboard the onClick will link to so the
      // server-side `getMissingOnClickDashboards` check resolves.
      const targetDashboard = await new Dashboard({
        name: 'Service Detail',
        tiles: [],
        team: team._id,
      }).save();

      const result = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'OnClick dashboard by id',
        tiles: [
          {
            name: 'Top Services',
            x: 0,
            y: 0,
            w: 12,
            h: 6,
            config: {
              displayType: 'table',
              sourceId,
              groupBy: "ResourceAttributes['service.name']",
              select: [{ aggFn: 'count' }],
              onClick: {
                type: 'dashboard',
                target: {
                  mode: 'id',
                  id: targetDashboard._id.toString(),
                },
                whereLanguage: 'sql',
                filters: [
                  {
                    kind: 'expressionTemplate',
                    expression: 'ServiceName',
                    template: "{{ResourceAttributes['service.name']}}",
                  },
                ],
              },
            },
          },
        ],
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.tiles[0].config.onClick).toEqual({
        type: 'dashboard',
        target: { mode: 'id', id: targetDashboard._id.toString() },
        whereLanguage: 'sql',
        filters: [
          {
            kind: 'expressionTemplate',
            expression: 'ServiceName',
            template: "{{ResourceAttributes['service.name']}}",
          },
        ],
      });
    });

    it('should round-trip a templated dashboard onClick (mode=template)', async () => {
      const sourceId = traceSource._id.toString();
      const result = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'OnClick dashboard by template',
        tiles: [
          {
            name: 'Service Picker',
            x: 0,
            y: 0,
            w: 12,
            h: 6,
            config: {
              displayType: 'table',
              sourceId,
              groupBy: 'SpanName',
              select: [{ aggFn: 'count' }],
              onClick: {
                type: 'dashboard',
                target: {
                  mode: 'template',
                  template: '{{TargetDashboard}}',
                },
                whereLanguage: 'lucene',
                whereTemplate:
                  "service.name:{{ResourceAttributes['service.name']}}",
              },
            },
          },
        ],
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.tiles[0].config.onClick).toEqual({
        type: 'dashboard',
        target: { mode: 'template', template: '{{TargetDashboard}}' },
        whereLanguage: 'lucene',
        whereTemplate: "service.name:{{ResourceAttributes['service.name']}}",
      });
    });

    it('should round-trip onClick on a raw SQL table tile', async () => {
      const connectionId = connection._id.toString();
      const sourceId = traceSource._id.toString();
      const result = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'SQL onClick',
        tiles: [
          {
            name: 'Raw SQL Table',
            x: 0,
            y: 0,
            w: 12,
            h: 6,
            config: {
              configType: 'sql',
              displayType: 'table',
              connectionId,
              sqlTemplate:
                'SELECT ServiceName, count() AS c FROM otel_traces GROUP BY ServiceName LIMIT 50',
              onClick: {
                type: 'search',
                target: { mode: 'id', id: sourceId },
                whereLanguage: 'sql',
                filters: [
                  {
                    kind: 'expressionTemplate',
                    expression: 'ServiceName',
                    template: '{{ServiceName}}',
                  },
                ],
              },
            },
          },
        ],
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.tiles[0].config.onClick).toEqual({
        type: 'search',
        target: { mode: 'id', id: sourceId },
        whereLanguage: 'sql',
        filters: [
          {
            kind: 'expressionTemplate',
            expression: 'ServiceName',
            template: '{{ServiceName}}',
          },
        ],
      });
    });

    it('should reject a table tile onClick referencing a non-existent dashboard', async () => {
      const sourceId = traceSource._id.toString();
      const ghostDashboardId = new mongoose.Types.ObjectId().toString();
      const result = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'OnClick missing dashboard',
        tiles: [
          {
            name: 'Top Services',
            config: {
              displayType: 'table',
              sourceId,
              select: [{ aggFn: 'count' }],
              onClick: {
                type: 'dashboard',
                target: { mode: 'id', id: ghostDashboardId },
                whereLanguage: 'sql',
              },
            },
          },
        ],
      });

      expect(result.isError).toBe(true);
      const text = getFirstText(result);
      expect(text).toContain('onClick dashboard');
      expect(text).toContain(ghostDashboardId);
    });

    it('should reject a table tile onClick search target with a non-log/trace source', async () => {
      // /search only renders log/trace sources; targeting a metric
      // source must be rejected at save time, matching the REST POST
      // path. Create the metric source inline so this test is
      // self-contained.
      const metricSource = await Source.create({
        kind: SourceKind.Metric,
        team: team._id,
        from: {
          databaseName: DEFAULT_DATABASE,
          tableName: '',
        },
        metricTables: {
          [MetricsDataType.Gauge.toLowerCase()]: 'otel_metrics_gauge',
          [MetricsDataType.Sum.toLowerCase()]: 'otel_metrics_sum',
          [MetricsDataType.Histogram.toLowerCase()]: 'otel_metrics_histogram',
        },
        timestampValueExpression: 'TimeUnix',
        connection: connection._id,
        name: 'Metrics',
      });
      const sourceId = traceSource._id.toString();

      const result = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'OnClick metric source',
        tiles: [
          {
            name: 'Top Services',
            config: {
              displayType: 'table',
              sourceId,
              select: [{ aggFn: 'count' }],
              onClick: {
                type: 'search',
                target: {
                  mode: 'id',
                  id: metricSource._id.toString(),
                },
                whereLanguage: 'sql',
              },
            },
          },
        ],
      });

      expect(result.isError).toBe(true);
      const text = getFirstText(result);
      expect(text).toContain('log or trace');
      expect(text).toContain(metricSource._id.toString());
    });

    it('should reject a table tile onClick with an invalid target.id', async () => {
      // target.id must be a valid ObjectId. Bad shape is caught by the
      // input schema and surfaces as the SDK's "Input validation error"
      // envelope rather than a custom 400 message.
      const sourceId = traceSource._id.toString();
      const result = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'OnClick bad object id',
        tiles: [
          {
            name: 'Top Services',
            config: {
              displayType: 'table',
              sourceId,
              select: [{ aggFn: 'count' }],
              onClick: {
                type: 'dashboard',
                target: { mode: 'id', id: 'not-a-valid-object-id' },
                whereLanguage: 'sql',
              },
            },
          },
        ],
      });

      expect(result.isError).toBe(true);
    });

    it('should accept onClick without whereLanguage (it is optional at the schema layer)', async () => {
      // SearchConditionLanguageSchema is `.optional()` in common-utils,
      // so omitting whereLanguage is allowed. Pin that behavior so a
      // future tightening of the schema doesn't quietly change it
      // without updating the docs that callers rely on.
      const sourceId = traceSource._id.toString();
      const result = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'OnClick no whereLanguage',
        tiles: [
          {
            name: 'Top Services',
            config: {
              displayType: 'table',
              sourceId,
              select: [{ aggFn: 'count' }],
              onClick: {
                type: 'search',
                target: { mode: 'id', id: sourceId },
                // whereLanguage intentionally omitted
              },
            },
          },
        ],
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.tiles[0].config.onClick).toMatchObject({
        type: 'search',
        target: { mode: 'id', id: sourceId },
      });
    });

    it('should reject an unknown onClick.type', async () => {
      // The schema is a discriminated union on `type`; a bogus type
      // must be rejected up front.
      const sourceId = traceSource._id.toString();
      const result = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'OnClick bad type',
        tiles: [
          {
            name: 'Top Services',
            config: {
              displayType: 'table',
              sourceId,
              select: [{ aggFn: 'count' }],
              onClick: {
                type: 'navigate-to-mars',
                target: { mode: 'id', id: sourceId },
                whereLanguage: 'sql',
              },
            },
          },
        ],
      });

      expect(result.isError).toBe(true);
    });

    it('should validate onClick on update too', async () => {
      // Round-trip a tile with no onClick, then update it to add an
      // onClick pointing at a non-existent dashboard. The PUT path
      // mirrors POST: missing dashboards are rejected with the same
      // message.
      const sourceId = traceSource._id.toString();
      const createResult = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'OnClick update validation',
        tiles: [
          {
            name: 'Top Services',
            config: {
              displayType: 'table',
              sourceId,
              select: [{ aggFn: 'count' }],
            },
          },
        ],
      });
      expect(createResult.isError).toBeFalsy();
      const created = JSON.parse(getFirstText(createResult));

      const ghostDashboardId = new mongoose.Types.ObjectId().toString();
      const updateResult = await callTool(client, 'hyperdx_save_dashboard', {
        id: created.id,
        name: 'OnClick update validation',
        tiles: [
          {
            ...created.tiles[0],
            config: {
              ...created.tiles[0].config,
              onClick: {
                type: 'dashboard',
                target: { mode: 'id', id: ghostDashboardId },
                whereLanguage: 'sql',
              },
            },
          },
        ],
      });

      expect(updateResult.isError).toBe(true);
      const text = getFirstText(updateResult);
      expect(text).toContain('onClick dashboard');
      expect(text).toContain(ghostDashboardId);
    });
  });

  describe('hyperdx_save_dashboard - top-level filters', () => {
    it('should round-trip dashboard-level filters on create', async () => {
      const sourceId = traceSource._id.toString();
      const createResult = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'Service Detail',
        tiles: [
          {
            name: 'Latency',
            config: {
              displayType: 'line',
              sourceId,
              select: [
                {
                  aggFn: 'quantile',
                  level: 0.95,
                  valueExpression: 'Duration',
                },
              ],
            },
          },
        ],
        filters: [
          {
            type: 'QUERY_EXPRESSION',
            name: 'Service',
            expression: 'ServiceName',
            sourceId,
            whereLanguage: 'sql',
          },
        ],
      });

      expect(createResult.isError).toBeFalsy();
      const created = JSON.parse(getFirstText(createResult));
      expect(created.filters).toHaveLength(1);
      expect(created.filters[0]).toMatchObject({
        type: 'QUERY_EXPRESSION',
        name: 'Service',
        expression: 'ServiceName',
        sourceId,
        whereLanguage: 'sql',
      });
      expect(typeof created.filters[0].id).toBe('string');

      const getResult = await callTool(client, 'hyperdx_get_dashboard', {
        id: created.id,
      });
      const fetched = JSON.parse(getFirstText(getResult));
      expect(fetched.filters).toEqual(created.filters);
    });

    it('should round-trip dashboard-level filters on update', async () => {
      const sourceId = traceSource._id.toString();
      const initial = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'No filters yet',
        tiles: [
          {
            name: 'Total',
            config: {
              displayType: 'number',
              sourceId,
              select: [{ aggFn: 'count' }],
            },
          },
        ],
      });
      expect(initial.isError).toBeFalsy();
      const created = JSON.parse(getFirstText(initial));
      expect(created.filters ?? []).toHaveLength(0);

      const updated = await callTool(client, 'hyperdx_save_dashboard', {
        id: created.id,
        name: 'With filters now',
        tiles: created.tiles,
        filters: [
          {
            id: new ObjectId().toString(),
            type: 'QUERY_EXPRESSION',
            name: 'Environment',
            expression: 'Environment',
            sourceId,
            whereLanguage: 'sql',
          },
        ],
      });
      expect(updated.isError).toBeFalsy();
      const after = JSON.parse(getFirstText(updated));
      expect(after.filters).toHaveLength(1);
      expect(after.filters[0]).toMatchObject({
        expression: 'Environment',
        name: 'Environment',
      });
    });

    it('preserves filter ids when callers round-trip them on update', async () => {
      const sourceId = traceSource._id.toString();
      const initial = await callTool(client, 'hyperdx_save_dashboard', {
        name: 'Round-trip filters',
        tiles: [
          {
            name: 'Total',
            config: {
              displayType: 'number',
              sourceId,
              select: [{ aggFn: 'count' }],
            },
          },
        ],
        filters: [
          {
            type: 'QUERY_EXPRESSION',
            name: 'Service',
            expression: 'ServiceName',
            sourceId,
            whereLanguage: 'sql',
          },
        ],
      });
      expect(initial.isError).toBeFalsy();
      const created = JSON.parse(getFirstText(initial));
      expect(created.filters).toHaveLength(1);
      const serviceFilterId = created.filters[0].id;
      expect(typeof serviceFilterId).toBe('string');

      // Round-trip the existing filter's id AND add a new filter
      // without an id. The existing id must be preserved (so any
      // savedFilterValues bound to it stay attached); the new filter
      // must get a fresh server-generated id.
      const updated = await callTool(client, 'hyperdx_save_dashboard', {
        id: created.id,
        name: 'Round-trip filters',
        tiles: created.tiles,
        filters: [
          {
            id: serviceFilterId,
            type: 'QUERY_EXPRESSION',
            name: 'Service',
            expression: 'ServiceName',
            sourceId,
            whereLanguage: 'sql',
          },
          {
            id: new ObjectId().toString(),
            type: 'QUERY_EXPRESSION',
            name: 'Severity',
            expression: 'SeverityText',
            sourceId,
            whereLanguage: 'sql',
          },
        ],
      });
      expect(updated.isError).toBeFalsy();
      const after = JSON.parse(getFirstText(updated));
      expect(after.filters).toHaveLength(2);

      const serviceFilter = after.filters.find(
        (f: { name: string }) => f.name === 'Service',
      );
      const severityFilter = after.filters.find(
        (f: { name: string }) => f.name === 'Severity',
      );
      expect(serviceFilter.id).toBe(serviceFilterId);
      expect(typeof severityFilter.id).toBe('string');
      expect(severityFilter.id).not.toBe(serviceFilterId);

      // A subsequent fetch must surface the same persisted ids — guards
      // against a path that lies in the update response but writes
      // something different to Mongo.
      const fetched = JSON.parse(
        getFirstText(
          await callTool(client, 'hyperdx_get_dashboard', { id: created.id }),
        ),
      );
      expect(fetched.filters).toHaveLength(2);
      expect(
        fetched.filters.find((f: { name: string }) => f.name === 'Service').id,
      ).toBe(serviceFilterId);
      expect(
        fetched.filters.find((f: { name: string }) => f.name === 'Severity').id,
      ).toBe(severityFilter.id);
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

  describe('buildQueryGuidePrompt', () => {
    it('documents heatmap in tile-type, constraints, mistakes, and aggFn sections', () => {
      const prompt = buildQueryGuidePrompt();
      // Ensure each section the bot called out has a heatmap entry so
      // the LLM cannot skip the constraints when producing a heatmap
      // tile through hyperdx_save_dashboard.
      const sections = [
        '== AGGREGATION FUNCTIONS (aggFn) ==',
        '== PER-TILE TYPE CONSTRAINTS ==',
        '== COMMON MISTAKES ==',
      ];
      for (const heading of sections) {
        const idx = prompt.indexOf(heading);
        expect(idx).toBeGreaterThan(-1);
        // Each section's body extends until the next == heading or the
        // end of the string. Checking for the substring "heatmap" in
        // that slice is enough to assert the heatmap entry exists.
        const next = prompt.indexOf('\n== ', idx + heading.length);
        const body = prompt.slice(idx, next === -1 ? prompt.length : next);
        expect(body.toLowerCase()).toContain('heatmap');
      }
    });

    it('documents table-tile onClick linking features', () => {
      // Lock down the documentation for row-click drill-downs so a
      // future refactor can't quietly drop the section the LLM relies
      // on to wire up onClick correctly.
      const prompt = buildQueryGuidePrompt();
      const idx = prompt.indexOf('== TABLE TILE LINKING (config.onClick) ==');
      expect(idx).toBeGreaterThan(-1);
      const next = prompt.indexOf('\n== ', idx + 1);
      const section = prompt.slice(idx, next === -1 ? prompt.length : next);

      // Both destination types are mentioned.
      expect(section).toContain('type: "search"');
      expect(section).toContain('type: "dashboard"');
      // Both target modes are mentioned.
      expect(section).toContain('mode: "id"');
      expect(section).toContain('mode: "template"');
      // Templating fields are mentioned.
      expect(section).toContain('whereTemplate');
      expect(section).toContain('filters');
      expect(section).toContain('expressionTemplate');
      // The two server-side validation error messages are quoted so
      // the LLM can recognize and recover from them.
      expect(section).toContain('onClick search source IDs');
      expect(section).toContain('onClick dashboard IDs');
    });

    it('documents onClick pitfalls under common mistakes', () => {
      const prompt = buildQueryGuidePrompt();
      const idx = prompt.indexOf('== COMMON MISTAKES ==');
      expect(idx).toBeGreaterThan(-1);
      const section = prompt.slice(idx);
      // Mention the four failure modes we hit during validation.
      expect(section.toLowerCase()).toContain('onclick on a non-table tile');
      expect(section.toLowerCase()).toContain('non-log/trace source');
      expect(section.toLowerCase()).toContain('missing wherelanguage');
      expect(section.toLowerCase()).toContain("isn't in the table");
    });
  });

  describe('buildCreateDashboardPrompt', () => {
    it("mentions row-click linking in the table tile's description", () => {
      // The create prompt is the LLM's primary entry point for new
      // dashboards. Surface onClick so it considers wiring it up on
      // overview tables without the user having to ask.
      const prompt = buildCreateDashboardPrompt(
        'summary',
        'trace_src',
        'log_src',
      );
      expect(prompt).toContain('ROW-CLICK LINKING');
      // The TILE TYPE GUIDE entry for "table" must hint at onClick.
      const guideIdx = prompt.indexOf('== TILE TYPE GUIDE ==');
      expect(guideIdx).toBeGreaterThan(-1);
      const guideEnd = prompt.indexOf('\n== ', guideIdx + 1);
      const guideBody = prompt.slice(guideIdx, guideEnd);
      expect(guideBody).toContain('onClick');
    });

    it('includes a dedicated row-click linking section with both link types', () => {
      const prompt = buildCreateDashboardPrompt(
        'summary',
        'trace_src',
        'log_src',
      );
      const idx = prompt.indexOf('== ROW-CLICK LINKING');
      expect(idx).toBeGreaterThan(-1);
      const next = prompt.indexOf('\n== ', idx + 1);
      const section = prompt.slice(idx, next === -1 ? prompt.length : next);

      expect(section).toContain('type: "search"');
      expect(section).toContain('type: "dashboard"');
      expect(section).toContain('target.mode: "id"');
      expect(section).toContain('target.mode: "template"');
      expect(section).toContain('whereTemplate');
      expect(section).toContain('filters');
    });
  });

  describe('buildDashboardExamplesPrompt', () => {
    it('exposes a drilldown_links example pattern', () => {
      const fullPrompt = buildDashboardExamplesPrompt(
        'trace_src',
        'log_src',
        'conn_id',
      );
      expect(fullPrompt).toContain('drilldown_links');

      // Requesting the specific pattern should return that example.
      const patternPrompt = buildDashboardExamplesPrompt(
        'trace_src',
        'log_src',
        'conn_id',
        'drilldown_links',
      );
      expect(patternPrompt).toContain('ROW-CLICK DRILL-DOWN LINKS');
      expect(patternPrompt).toContain('onClick');
      expect(patternPrompt).toContain('type: "search"');
      expect(patternPrompt).toContain('type: "dashboard"');
      expect(patternPrompt).toContain('expressionTemplate');
    });
  });
});
