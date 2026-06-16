import { MetricsDataType, SourceKind } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';

import { DEFAULT_DATABASE } from '@/fixtures';
import Dashboard from '@/models/dashboard';
import { Source } from '@/models/source';
import type { ExternalDashboardTileWithId } from '@/utils/zod';

import { callTool, getFirstText } from '../mcpTestUtils';
import { setupDashboardTests } from './setup';

describe('MCP Dashboard Tools - clickstack_save_dashboard', () => {
  const ctx = setupDashboardTests();

  describe('basic CRUD', () => {
    it('should create a new dashboard with tiles', async () => {
      const sourceId = ctx.traceSource._id.toString();
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
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
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
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
      const sourceId = ctx.traceSource._id.toString();

      // Create first
      const createResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
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
        },
      );
      const created = JSON.parse(getFirstText(createResult));

      // Update
      const updateResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
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
        },
      );

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
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
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
      const sourceId = ctx.traceSource._id.toString();
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
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
      const sourceId = ctx.traceSource._id.toString();
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
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
      const connectionId = ctx.connection._id.toString();
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
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

    it('should persist sourceId on a raw SQL tile that uses $__filters', async () => {
      const connectionId = ctx.connection._id.toString();
      const sourceId = ctx.traceSource._id.toString();
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
        name: 'SQL Dashboard with filters',
        tiles: [
          {
            name: 'Filtered SQL',
            config: {
              configType: 'sql',
              displayType: 'table',
              connectionId,
              sourceId,
              sqlTemplate:
                'SELECT ServiceName, count() AS c FROM otel_traces WHERE $__timeFilter(Timestamp) AND $__filters GROUP BY ServiceName LIMIT 10',
            },
          },
        ],
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.tiles).toHaveLength(1);
      // sourceId must round-trip so the $__filters macro can resolve.
      expect(output.tiles[0].config.sourceId).toBe(sourceId);

      const dashboard = await Dashboard.findById(output.id);
      expect(dashboard?.tiles?.[0]?.config?.source?.toString()).toBe(sourceId);
    });

    it('should reject a raw SQL tile that uses $__filters without a sourceId', async () => {
      const connectionId = ctx.connection._id.toString();
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
        name: 'SQL Dashboard missing source',
        tiles: [
          {
            name: 'Filtered SQL',
            config: {
              configType: 'sql',
              displayType: 'table',
              connectionId,
              sqlTemplate:
                'SELECT ServiceName, count() AS c FROM otel_traces WHERE $__timeFilter(Timestamp) AND $__filters GROUP BY ServiceName LIMIT 10',
            },
          },
        ],
      });

      expect(result.isError).toBe(true);
      const text = getFirstText(result);
      expect(text).toContain('sourceId');
      expect(text).toContain('$__filters');
      expect(text).toContain('Filtered SQL');

      // Nothing should have been persisted.
      expect(await Dashboard.countDocuments({})).toBe(0);
    });

    it('should reject a raw SQL tile that uses $__sourceTable without a sourceId', async () => {
      const connectionId = ctx.connection._id.toString();
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
        name: 'SQL Dashboard missing source',
        tiles: [
          {
            name: 'Source Table SQL',
            config: {
              configType: 'sql',
              displayType: 'table',
              connectionId,
              sqlTemplate:
                'SELECT ServiceName, count() AS c FROM $__sourceTable WHERE $__timeFilter(Timestamp) GROUP BY ServiceName LIMIT 10',
            },
          },
        ],
      });

      expect(result.isError).toBe(true);
      const text = getFirstText(result);
      expect(text).toContain('sourceId');
      expect(text).toContain('$__sourceTable');
      expect(text).toContain('Source Table SQL');

      // Nothing should have been persisted.
      expect(await Dashboard.countDocuments({})).toBe(0);
    });

    it('should allow a raw SQL tile without a sourceId when it does not use $__filters', async () => {
      const connectionId = ctx.connection._id.toString();
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
        name: 'Multi-table SQL Dashboard',
        tiles: [
          {
            name: 'Joined SQL',
            config: {
              configType: 'sql',
              displayType: 'table',
              connectionId,
              sqlTemplate:
                'SELECT t.ServiceName, count() AS c FROM otel_traces t JOIN otel_logs l ON t.TraceId = l.TraceId GROUP BY t.ServiceName LIMIT 10',
            },
          },
        ],
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.tiles).toHaveLength(1);
    });

    it('should preserve display fields on raw SQL tiles through save, get, update, and re-get', async () => {
      const connectionId = ctx.connection._id.toString();
      const sqlConfig = {
        configType: 'sql' as const,
        displayType: 'line' as const,
        connectionId,
        sqlTemplate:
          'SELECT $__timeInterval(Timestamp) AS ts, avg(Duration) AS v FROM otel_traces WHERE $__timeFilter(Timestamp) GROUP BY ts ORDER BY ts LIMIT 1000',
        numberFormat: {
          output: 'percent' as const,
          mantissa: 2,
          thousandSeparated: true,
        },
        compareToPreviousPeriod: true,
        fitYAxisToData: true,
      };
      const sqlNumberConfig = {
        configType: 'sql' as const,
        displayType: 'number' as const,
        connectionId,
        sqlTemplate: 'SELECT 0.99 AS value LIMIT 1',
        numberFormat: { output: 'percent' as const, mantissa: 2 },
      };

      const saveResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
          name: 'SQL NumberFormat Round-Trip',
          tiles: [
            { name: 'CPU %', config: sqlConfig },
            { name: 'SLO', config: sqlNumberConfig },
            {
              name: 'Other Tile',
              config: {
                configType: 'sql' as const,
                displayType: 'table' as const,
                connectionId,
                sqlTemplate: 'SELECT 1 AS value LIMIT 1',
              },
            },
          ],
        },
      );
      expect(saveResult.isError).toBeFalsy();
      const saved = JSON.parse(getFirstText(saveResult));
      const savedSqlTile = saved.tiles.find(
        (t: { name: string }) => t.name === 'CPU %',
      );
      expect(savedSqlTile.config).toMatchObject(sqlConfig);
      const savedSqlNumberTile = saved.tiles.find(
        (t: { name: string }) => t.name === 'SLO',
      );
      expect(savedSqlNumberTile.config).toMatchObject(sqlNumberConfig);

      const getResult = await callTool(
        ctx.client!,
        'clickstack_get_dashboard',
        { id: saved.id },
      );
      expect(getResult.isError).toBeFalsy();
      const fetched = JSON.parse(getFirstText(getResult));
      const fetchedSqlTile = fetched.tiles.find(
        (t: { name: string }) => t.name === 'CPU %',
      );
      expect(fetchedSqlTile.config).toMatchObject(sqlConfig);

      // Update a DIFFERENT tile, passing all fetched tiles back — the
      // formatted SQL tile must survive the round-trip untouched.
      const updateResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
          id: saved.id,
          name: 'SQL NumberFormat Round-Trip',
          tiles: fetched.tiles.map((t: { name: string; config: object }) =>
            t.name === 'Other Tile'
              ? {
                  ...t,
                  config: {
                    ...t.config,
                    sqlTemplate: 'SELECT 2 AS value LIMIT 1',
                  },
                }
              : t,
          ),
        },
      );
      expect(updateResult.isError).toBeFalsy();

      const getAfterUpdate = await callTool(
        ctx.client!,
        'clickstack_get_dashboard',
        { id: saved.id },
      );
      expect(getAfterUpdate.isError).toBeFalsy();
      const refetched = JSON.parse(getFirstText(getAfterUpdate));
      const refetchedSqlTile = refetched.tiles.find(
        (t: { name: string }) => t.name === 'CPU %',
      );
      expect(refetchedSqlTile.config).toMatchObject(sqlConfig);
      const refetchedSqlNumberTile = refetched.tiles.find(
        (t: { name: string }) => t.name === 'SLO',
      );
      expect(refetchedSqlNumberTile.config).toMatchObject(sqlNumberConfig);
    });

    it('should create a dashboard with a heatmap tile on a Trace source', async () => {
      const sourceId = ctx.traceSource._id.toString();
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
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
      const sourceId = ctx.traceSource._id.toString();

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

      const saveResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
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
        },
      );
      expect(saveResult.isError).toBeFalsy();
      const saved = JSON.parse(getFirstText(saveResult));
      expect(saved.tiles).toHaveLength(1);
      expect(saved.tiles[0].config).toMatchObject(createConfig);

      const getResult = await callTool(
        ctx.client!,
        'clickstack_get_dashboard',
        {
          id: saved.id,
        },
      );
      expect(getResult.isError).toBeFalsy();
      const fetched = JSON.parse(getFirstText(getResult));
      expect(fetched.tiles[0].config).toMatchObject(createConfig);

      const updateResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
          id: saved.id,
          name: 'Heatmap Full Round-Trip',
          tiles: [
            {
              ...fetched.tiles[0],
              config: { ...fetched.tiles[0].config, ...updatedConfig },
            },
          ],
        },
      );
      expect(updateResult.isError).toBeFalsy();
      const updated = JSON.parse(getFirstText(updateResult));
      expect(updated.tiles[0].config).toMatchObject(updatedConfig);

      const getAfterUpdate = await callTool(
        ctx.client!,
        'clickstack_get_dashboard',
        {
          id: saved.id,
        },
      );
      expect(getAfterUpdate.isError).toBeFalsy();
      const refetched = JSON.parse(getFirstText(getAfterUpdate));
      expect(refetched.tiles[0].config).toMatchObject(updatedConfig);
    });

    it('should reject heatmap tile with empty valueExpression at the schema layer', async () => {
      const sourceId = ctx.traceSource._id.toString();
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
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
        const sourceId = ctx.traceSource._id.toString();

        const saveResult = await callTool(
          ctx.client!,
          'clickstack_save_dashboard',
          {
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
          },
        );

        expect(saveResult.isError).toBeFalsy();
        const saved = JSON.parse(getFirstText(saveResult));

        const getResult = await callTool(
          ctx.client!,
          'clickstack_get_dashboard',
          {
            id: saved.id,
          },
        );
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
      const sourceId = ctx.traceSource._id.toString();
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
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

    it('should preserve display fields on builder tiles through save, get, update, and re-get', async () => {
      const sourceId = ctx.traceSource._id.toString();
      const numberFormat = {
        output: 'percent' as const,
        mantissa: 2,
        thousandSeparated: true,
      };
      const lineConfig = {
        displayType: 'line' as const,
        sourceId,
        select: [{ aggFn: 'count' as const, alias: 'Requests' }],
        numberFormat,
        compareToPreviousPeriod: true,
        fitYAxisToData: true,
      };
      const barConfig = {
        displayType: 'stacked_bar' as const,
        sourceId,
        select: [{ aggFn: 'count' as const, alias: 'Requests' }],
        numberFormat,
      };
      const tableConfig = {
        displayType: 'table' as const,
        sourceId,
        select: [{ aggFn: 'count' as const, alias: 'Requests' }],
        groupBy: 'SpanName',
        numberFormat,
      };
      const pieConfig = {
        displayType: 'pie' as const,
        sourceId,
        select: [{ aggFn: 'count' as const, alias: 'Requests' }],
        groupBy: 'SpanName',
        numberFormat,
      };
      const numberConfig = {
        displayType: 'number' as const,
        sourceId,
        select: [{ aggFn: 'count' as const, alias: 'Requests' }],
        numberFormat,
      };
      const tiles = [
        { name: 'Line', config: lineConfig },
        { name: 'Bar', config: barConfig },
        { name: 'Table', config: tableConfig },
        { name: 'Pie', config: pieConfig },
        { name: 'Number', config: numberConfig },
      ];
      const configByName: Record<string, object> = {
        Line: lineConfig,
        Bar: barConfig,
        Table: tableConfig,
        Pie: pieConfig,
        Number: numberConfig,
      };
      const assertTiles = (output: { tiles: { name: string }[] }) => {
        for (const [name, config] of Object.entries(configByName)) {
          const tile = output.tiles.find(t => t.name === name);
          expect(tile).toMatchObject({ config });
        }
      };

      const saveResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        { name: 'Builder Display Fields', tiles },
      );
      expect(saveResult.isError).toBeFalsy();
      const saved = JSON.parse(getFirstText(saveResult));
      assertTiles(saved);

      const getResult = await callTool(
        ctx.client!,
        'clickstack_get_dashboard',
        { id: saved.id },
      );
      expect(getResult.isError).toBeFalsy();
      const fetched = JSON.parse(getFirstText(getResult));
      assertTiles(fetched);

      // Update passing all fetched tiles back verbatim — every display
      // field must survive a second pass through the MCP input schema.
      const updateResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
          id: saved.id,
          name: 'Builder Display Fields (updated)',
          tiles: fetched.tiles,
        },
      );
      expect(updateResult.isError).toBeFalsy();

      const getAfterUpdate = await callTool(
        ctx.client!,
        'clickstack_get_dashboard',
        { id: saved.id },
      );
      expect(getAfterUpdate.isError).toBeFalsy();
      assertTiles(JSON.parse(getFirstText(getAfterUpdate)));
    });

    it('should reject heatmap tile on a non-Trace source', async () => {
      // Create a Log source so the heatmap source-kind gate has
      // something to reject. The schema accepts the tile shape (the
      // sourceId is valid), so this exercises the runtime check that
      // the REST POST path also runs.
      const logSource = await Source.create({
        kind: SourceKind.Log,
        team: ctx.team._id,
        from: {
          databaseName: DEFAULT_DATABASE,
          tableName: 'otel_logs',
        },
        timestampValueExpression: 'Timestamp',
        connection: ctx.connection._id,
        name: 'Logs',
      });

      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
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
        team: ctx.team._id,
        from: { databaseName: DEFAULT_DATABASE, tableName: 'otel_logs' },
        timestampValueExpression: 'Timestamp',
        connection: ctx.connection._id,
        name: 'Logs',
      });

      const created = await callTool(ctx.client!, 'clickstack_save_dashboard', {
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

      const update = await callTool(ctx.client!, 'clickstack_save_dashboard', {
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
        team: ctx.team._id,
        from: { databaseName: DEFAULT_DATABASE, tableName: 'otel_logs' },
        timestampValueExpression: 'Timestamp',
        connection: ctx.connection._id,
        name: 'Logs',
      });

      const created = await callTool(ctx.client!, 'clickstack_save_dashboard', {
        name: 'Heatmap re-pointed at Log',
        tiles: [
          {
            name: 'Heatmap',
            config: {
              displayType: 'heatmap',
              sourceId: ctx.traceSource._id.toString(),
              select: [{ valueExpression: 'Duration' }],
            },
          },
        ],
      });
      expect(created.isError).toBeFalsy();
      const saved = JSON.parse(getFirstText(created));

      const update = await callTool(ctx.client!, 'clickstack_save_dashboard', {
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
      const sourceId = ctx.traceSource._id.toString();

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

      const save = await callTool(ctx.client!, 'clickstack_save_dashboard', {
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
          await callTool(ctx.client!, 'clickstack_get_dashboard', {
            id: saved.id,
          }),
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

  describe('containers and tabs', () => {
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
      const sourceId = ctx.traceSource._id.toString();
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

      const createResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
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
        },
      );

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
      const getResult = await callTool(
        ctx.client!,
        'clickstack_get_dashboard',
        {
          id: created.id,
        },
      );
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

      const updateResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
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
        },
      );

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
      const sourceId = ctx.traceSource._id.toString();
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
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
      const sourceId = ctx.traceSource._id.toString();
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
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
      const sourceId = ctx.traceSource._id.toString();
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
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
      const sourceId = ctx.traceSource._id.toString();
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
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
      const sourceId = ctx.traceSource._id.toString();
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
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
      const sourceId = ctx.traceSource._id.toString();
      const containers = [
        {
          id: 'service-health',
          title: 'Service Health',
          collapsed: false,
          tabs: [{ id: 'errors', title: 'Errors' }],
        },
      ];
      const createResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
          name: 'PUT-without-containers fallback',
          tiles: [
            buildTile(sourceId, {
              name: 'In Group',
              containerId: 'service-health',
              tabId: 'errors',
            }),
          ],
          containers,
        },
      );
      expect(createResult.isError).toBeFalsy();
      const created = JSON.parse(getFirstText(createResult));

      const updateResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
          id: created.id,
          name: 'PUT-without-containers fallback',
          tiles: created.tiles,
          // containers intentionally omitted
        },
      );
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
      const sourceId = ctx.traceSource._id.toString();
      const createResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
          name: 'Wipe containers',
          tiles: [buildTile(sourceId, { name: 'Tile' })],
          containers: [{ id: 'overview', title: 'Overview', collapsed: false }],
        },
      );
      expect(createResult.isError).toBeFalsy();
      const created = JSON.parse(getFirstText(createResult));
      expect(created.containers).toHaveLength(1);

      const wipedTile = {
        ...created.tiles[0],
        containerId: undefined,
        tabId: undefined,
      };
      const updateResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
          id: created.id,
          name: 'Wipe containers',
          tiles: [wipedTile],
          containers: [],
        },
      );
      expect(updateResult.isError).toBeFalsy();
      const updated = JSON.parse(getFirstText(updateResult));
      expect(updated.containers).toBeUndefined();

      const getResult = await callTool(
        ctx.client!,
        'clickstack_get_dashboard',
        {
          id: created.id,
        },
      );
      const fetched = JSON.parse(getFirstText(getResult));
      expect(fetched.containers).toBeUndefined();
    });

    // Bounds mirror DASHBOARD_CONTAINER_ID_MAX (256) on the tile-level
    // containerId / tabId. 256 chars must accept; 257 must reject.
    // 257 trips the inputSchema's `.max(256)` and surfaces back as the
    // MCP SDK's "Input validation error" envelope.
    it('should accept a 256-char tile.containerId and reject 257', async () => {
      const sourceId = ctx.traceSource._id.toString();
      const idAtMax = 'c'.repeat(256);
      const okResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
          name: '256-char containerId',
          tiles: [buildTile(sourceId, { containerId: idAtMax })],
          containers: [{ id: idAtMax, title: 'Max', collapsed: false }],
        },
      );
      expect(okResult.isError).toBeFalsy();

      const idTooLong = 'c'.repeat(257);
      const tooLongResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
          name: '257-char containerId',
          tiles: [buildTile(sourceId, { containerId: idTooLong })],
          containers: [{ id: idTooLong, title: 'Too long', collapsed: false }],
        },
      );
      expect(tooLongResult.isError).toBe(true);
      expect(getFirstText(tooLongResult)).toContain(
        'String must contain at most 256 character(s)',
      );
      expect(getFirstText(tooLongResult)).toContain('containerId');
    });
  });

  describe('dashboard filters', () => {
    // The MCP input schema delegates to createDashboardBodySchema /
    // updateDashboardBodySchema for the filter shape. These tests guard
    // that the MCP path lights up the same filter round-trip the v2 REST
    // path already covers: filters are saved verbatim, get back with an
    // assigned id, survive an update, and reject obvious bad inputs.

    const traceTile = (sourceId: string) => ({
      name: 'Volume',
      x: 0,
      y: 0,
      w: 6,
      h: 3,
      config: {
        displayType: 'line' as const,
        sourceId,
        select: [{ aggFn: 'count' as const, where: '' }],
      },
    });

    it('should round-trip filters on create, get, and update', async () => {
      const sourceId = ctx.traceSource._id.toString();

      const createResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
          name: 'Service Detail (MCP filter round-trip)',
          tiles: [traceTile(sourceId)],
          filters: [
            {
              type: 'QUERY_EXPRESSION',
              name: 'Service',
              expression: 'ServiceName',
              sourceId,
            },
            {
              type: 'QUERY_EXPRESSION',
              name: 'Environment',
              expression: 'deployment.environment',
              sourceId,
              where: "deployment.environment = 'production'",
              whereLanguage: 'sql',
            },
          ],
        },
      );

      expect(createResult.isError).toBeFalsy();
      const created = JSON.parse(getFirstText(createResult));
      expect(Array.isArray(created.filters)).toBe(true);
      expect(created.filters).toHaveLength(2);
      // The body schema assigns an id to each filter on create. Capture
      // them so the update payload can include the same ids and the
      // filter array round-trips identically (instead of being treated
      // as wholesale replacement with new ids).
      const [serviceFilter, envFilter] = created.filters;
      expect(serviceFilter).toMatchObject({
        type: 'QUERY_EXPRESSION',
        name: 'Service',
        expression: 'ServiceName',
        sourceId,
      });
      expect(typeof serviceFilter.id).toBe('string');
      expect(serviceFilter.id.length).toBeGreaterThan(0);
      expect(envFilter).toMatchObject({
        type: 'QUERY_EXPRESSION',
        name: 'Environment',
        expression: 'deployment.environment',
        sourceId,
        where: "deployment.environment = 'production'",
        whereLanguage: 'sql',
      });

      // Fetch and assert the same shape.
      const getResult = await callTool(
        ctx.client!,
        'clickstack_get_dashboard',
        {
          id: created.id,
        },
      );
      const fetched = JSON.parse(getFirstText(getResult));
      expect(fetched.filters).toEqual(created.filters);

      // Update: rename the first filter and drop the second. The first
      // filter keeps its id, the second is dropped (not preserved).
      const updateResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
          id: created.id,
          name: 'Service Detail (MCP filter round-trip)',
          tiles: [traceTile(sourceId)],
          filters: [
            {
              id: serviceFilter.id,
              type: 'QUERY_EXPRESSION',
              name: 'Service (renamed)',
              expression: 'ServiceName',
              sourceId,
            },
          ],
        },
      );

      expect(updateResult.isError).toBeFalsy();
      const updated = JSON.parse(getFirstText(updateResult));
      expect(updated.filters).toHaveLength(1);
      expect(updated.filters[0]).toMatchObject({
        id: serviceFilter.id,
        type: 'QUERY_EXPRESSION',
        name: 'Service (renamed)',
        expression: 'ServiceName',
        sourceId,
      });
    });

    it('should accept a create payload with stray filter ids (copy-paste round-trip)', async () => {
      // An LLM that copies a filter out of clickstack_get_dashboard and
      // back into clickstack_save_dashboard for a NEW dashboard ships an
      // `id` on the filter. The body schema for create is
      // `.strict()` and rejects `id`, so saveDashboard normalizes by
      // stripping ids before validation. Without that normalization
      // this payload would 4xx with a confusing strict-validation
      // error.
      const sourceId = ctx.traceSource._id.toString();
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
        name: 'Create with stray filter id',
        tiles: [traceTile(sourceId)],
        filters: [
          {
            id: '999999999999999999999999', // simulates a copied id
            type: 'QUERY_EXPRESSION',
            name: 'Service',
            expression: 'ServiceName',
            sourceId,
          },
        ],
      });
      expect(result.isError).toBeFalsy();
      const dashboard = JSON.parse(getFirstText(result));
      expect(dashboard.filters).toHaveLength(1);
      // The new dashboard gets a fresh id; the copied one is discarded.
      expect(dashboard.filters[0].id).not.toBe('999999999999999999999999');
      expect(dashboard.filters[0]).toMatchObject({
        type: 'QUERY_EXPRESSION',
        name: 'Service',
        expression: 'ServiceName',
        sourceId,
      });
    });

    it('should assign ids to new filters added during update (no-id round-trip)', async () => {
      // An LLM updating a dashboard to ADD a brand-new filter ships
      // a filter without an `id`. The body schema for update requires
      // id, so saveDashboard fills one in. Without that normalization
      // this payload would 4xx complaining that id is missing.
      const sourceId = ctx.traceSource._id.toString();
      const createResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
          name: 'Update adds new filter',
          tiles: [traceTile(sourceId)],
          filters: [
            {
              type: 'QUERY_EXPRESSION',
              name: 'Service',
              expression: 'ServiceName',
              sourceId,
            },
          ],
        },
      );
      const created = JSON.parse(getFirstText(createResult));
      const existingFilterId = created.filters[0].id;

      const updateResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
          id: created.id,
          name: 'Update adds new filter',
          tiles: [traceTile(sourceId)],
          filters: [
            // Existing filter, preserved by id.
            {
              id: existingFilterId,
              type: 'QUERY_EXPRESSION',
              name: 'Service',
              expression: 'ServiceName',
              sourceId,
            },
            // Brand-new filter, no id. saveDashboard assigns one.
            {
              type: 'QUERY_EXPRESSION',
              name: 'Environment',
              expression: 'deployment.environment',
              sourceId,
            },
          ],
        },
      );
      expect(updateResult.isError).toBeFalsy();
      const updated = JSON.parse(getFirstText(updateResult));
      expect(updated.filters).toHaveLength(2);
      const envFilter = updated.filters.find(
        (f: { name: string }) => f.name === 'Environment',
      );
      expect(envFilter).toBeDefined();
      expect(typeof envFilter.id).toBe('string');
      expect(envFilter.id.length).toBeGreaterThan(0);
      expect(envFilter.id).not.toBe(existingFilterId);
    });

    it('should round-trip a table tile that uses a having clause', async () => {
      // mcpTableTileSchema exposes `having` so the service_detail
      // example's "Top Error Messages" pattern (groupBy StatusMessage
      // with having: "StatusMessage != ''") survives MCP authoring.
      // Without `having` on the schema, Zod would strip it and the
      // saved tile would include empty-message rows instead of the
      // filtered set the prompt promises.
      const sourceId = ctx.traceSource._id.toString();
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
        name: 'Top Error Messages',
        tiles: [
          {
            name: 'Top Error Messages',
            x: 0,
            y: 0,
            w: 12,
            h: 6,
            config: {
              displayType: 'table',
              sourceId,
              select: [{ aggFn: 'count', alias: 'Count' }],
              groupBy: 'StatusMessage',
              having: "StatusMessage != ''",
              orderBy: 'Count DESC',
              groupByColumnsOnLeft: true,
            },
          },
        ],
      });
      expect(result.isError).toBeFalsy();
      const dashboard = JSON.parse(getFirstText(result));
      expect(dashboard.tiles[0].config.having).toBe("StatusMessage != ''");
    });
  });

  describe('table onClick linking', () => {
    // Mirrors the v2 external-API onClick tests so the MCP path
    // enforces the same drill-down rules: row-click can target /search
    // for a log/trace source or another dashboard, by concrete ID or
    // by templated name, with optional whereTemplate/filters.
    it('should round-trip a table tile with a search onClick by ID', async () => {
      const sourceId = ctx.traceSource._id.toString();
      const createResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
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
        },
      );

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

      const getResult = await callTool(
        ctx.client!,
        'clickstack_get_dashboard',
        {
          id: created.id,
        },
      );
      const fetched = JSON.parse(getFirstText(getResult));
      expect(fetched.tiles[0].config.onClick).toEqual(
        created.tiles[0].config.onClick,
      );
    });

    it('should round-trip a table tile with a dashboard onClick by ID', async () => {
      const sourceId = ctx.traceSource._id.toString();
      // Create the target dashboard the onClick will link to so the
      // server-side `getMissingOnClickDashboards` check resolves.
      const targetDashboard = await new Dashboard({
        name: 'Service Detail',
        tiles: [],
        team: ctx.team._id,
      }).save();

      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
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
      const sourceId = ctx.traceSource._id.toString();
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
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
      const connectionId = ctx.connection._id.toString();
      const sourceId = ctx.traceSource._id.toString();
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
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
      const sourceId = ctx.traceSource._id.toString();
      const ghostDashboardId = new mongoose.Types.ObjectId().toString();
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
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
        team: ctx.team._id,
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
        connection: ctx.connection._id,
        name: 'Metrics',
      });
      const sourceId = ctx.traceSource._id.toString();

      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
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
      const sourceId = ctx.traceSource._id.toString();
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
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
      const sourceId = ctx.traceSource._id.toString();
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
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
      const sourceId = ctx.traceSource._id.toString();
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
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
      const sourceId = ctx.traceSource._id.toString();
      const createResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
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
        },
      );
      expect(createResult.isError).toBeFalsy();
      const created = JSON.parse(getFirstText(createResult));

      const ghostDashboardId = new mongoose.Types.ObjectId().toString();
      const updateResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
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
        },
      );

      expect(updateResult.isError).toBe(true);
      const text = getFirstText(updateResult);
      expect(text).toContain('onClick dashboard');
      expect(text).toContain(ghostDashboardId);
    });
  });
});
