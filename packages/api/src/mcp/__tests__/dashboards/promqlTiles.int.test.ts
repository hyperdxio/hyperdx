import { DisplayType, SourceKind } from '@hyperdx/common-utils/dist/types';

import { callTool, getFirstText } from '@/mcp/__tests__/mcpTestUtils';
import Dashboard from '@/models/dashboard';
import { Source } from '@/models/source';

import { setupDashboardTests } from './setup';

describe('MCP Dashboard Tools - PromQL tiles and label filters', () => {
  const ctx = setupDashboardTests();
  let promqlSourceId: string;

  beforeEach(async () => {
    const source = await Source.create({
      kind: SourceKind.Promql,
      team: ctx.team._id,
      connection: ctx.connection._id,
      name: 'Metrics',
      from: { databaseName: 'default', tableName: 'promql_metrics' },
      timestampValueExpression: 'timestamp',
    });
    promqlSourceId = source._id.toString();
  });

  const storedPromqlTile = () => ({
    id: 'promql-tile',
    x: 0,
    y: 0,
    w: 6,
    h: 3,
    config: {
      configType: 'promql',
      name: 'PromQL',
      displayType: DisplayType.Line,
      source: promqlSourceId,
      promqlExpression: [{ expression: 'up' }],
    },
  });

  const storedMarkdownTile = {
    id: 'markdown-tile',
    x: 6,
    y: 0,
    w: 6,
    h: 3,
    config: {
      name: 'Notes',
      displayType: DisplayType.Markdown,
      markdown: 'Notes',
      source: '',
      where: '',
      select: [],
    },
  };

  const storedLabelFilter = () => ({
    id: 'label-filter',
    type: 'PROMETHEUS_LABEL' as const,
    name: 'Job',
    source: promqlSourceId,
    label: 'job',
    isBroadcastEnabled: false as const,
    isVariableEnabled: true as const,
  });

  const createStoredDashboard = () =>
    new Dashboard({
      name: 'PromQL dashboard',
      tiles: [storedPromqlTile(), storedMarkdownTile],
      filters: [storedLabelFilter()],
      team: ctx.team._id,
    }).save();

  const parseOutput = (result: Awaited<ReturnType<typeof callTool>>) =>
    JSON.parse(getFirstText(result));

  describe('with PromQL enabled', () => {
    beforeEach(() => ctx.reconnect({ promqlEnabled: true }));

    const promqlTileInputs = () => {
      const base = { configType: 'promql', sourceId: promqlSourceId };
      const rate = 'sum by (job) (rate(http_requests_total[$__rate_interval]))';
      return [
        {
          name: 'Line',
          config: {
            ...base,
            displayType: 'line',
            expressions: [{ expression: rate, alias: 'Requests' }],
            legendTemplate: '{{job}}',
            granularity: '1 minute',
            fillNulls: false,
            alignDateRangeToGranularity: false,
            seriesLimit: 5,
            compareToPreviousPeriod: true,
            lineInterpolation: 'step',
          },
        },
        {
          name: 'Stacked bar',
          config: {
            ...base,
            displayType: 'stacked_bar',
            expressions: [{ expression: rate }, { expression: 'sum(up)' }],
            seriesLimit: 3,
          },
        },
        {
          name: 'Stacked line',
          config: {
            ...base,
            displayType: 'stacked_line',
            expressions: [{ expression: rate }],
            lineInterpolation: 'linear',
          },
        },
        {
          name: 'Table',
          config: {
            ...base,
            displayType: 'table',
            expressions: [{ expression: 'up', queryType: 'instant' }],
          },
        },
        {
          name: 'Number',
          config: {
            ...base,
            displayType: 'number',
            expressions: [
              { expression: 'sum(up)', queryType: 'range', reducer: 'max' },
            ],
            numberFormat: { output: 'number', mantissa: 1 },
            color: 'chart-green',
            colorRules: [{ operator: 'lt', value: 1, color: 'chart-error' }],
            backgroundChart: { type: 'area' },
          },
        },
        {
          name: 'Pie',
          config: {
            ...base,
            displayType: 'pie',
            expressions: [
              { expression: 'sum by (job) (up)', reducer: 'lastNotNull' },
            ],
            legendTemplate: '{{job}}',
            limit: 4,
          },
        },
        {
          name: 'Bar',
          config: {
            ...base,
            displayType: 'bar',
            expressions: [{ expression: 'sum by (job) (up)' }],
            limit: 0,
          },
        },
        {
          name: 'Heatmap',
          config: {
            ...base,
            displayType: 'heatmap',
            expressions: [
              {
                expression:
                  'sum by (le) (rate(http_request_duration_seconds_bucket[$__rate_interval]))',
              },
            ],
            heatmapMode: 'histogram',
            heatmapScaleType: 'log',
            legendTemplate: '{{le}}',
          },
        },
      ];
    };

    it('round-trips every display type through save, get and save', async () => {
      const inputTiles = promqlTileInputs();
      const created = await callTool(ctx.client!, 'clickstack_save_dashboard', {
        name: 'PromQL dashboard',
        tiles: inputTiles,
      });
      expect(created.isError).toBeFalsy();
      const { id } = parseOutput(created);
      const storedBefore = (await Dashboard.findById(id).lean())?.tiles;

      const read = await callTool(ctx.client!, 'clickstack_get_dashboard', {
        id,
      });
      const readTiles = parseOutput(read).tiles;
      for (const input of inputTiles) {
        const readTile = readTiles.find(
          (t: { name: string }) => t.name === input.name,
        );
        expect(readTile.config).toMatchObject(input.config);
      }

      const saved = await callTool(ctx.client!, 'clickstack_save_dashboard', {
        id,
        name: 'PromQL dashboard',
        tiles: readTiles,
      });
      expect(saved.isError).toBeFalsy();
      const storedAfter = (await Dashboard.findById(id).lean())?.tiles;
      expect(storedAfter).toEqual(storedBefore);
    });

    it('round-trips a PROMETHEUS_LABEL filter', async () => {
      const filter = {
        type: 'PROMETHEUS_LABEL',
        name: 'Job',
        sourceId: promqlSourceId,
        label: 'job',
        match: 'up{env="prod"}',
        variableName: 'job',
        maxSelections: 1,
      };
      const created = await callTool(ctx.client!, 'clickstack_save_dashboard', {
        name: 'Filtered',
        tiles: [],
        filters: [filter],
      });
      expect(created.isError).toBeFalsy();
      const { id, filters } = parseOutput(created);
      expect(filters).toEqual([
        expect.objectContaining({
          ...filter,
          isBroadcastEnabled: false,
          isVariableEnabled: true,
        }),
      ]);

      const saved = await callTool(ctx.client!, 'clickstack_save_dashboard', {
        id,
        name: 'Filtered',
        tiles: [],
        filters,
      });
      expect(saved.isError).toBeFalsy();
      expect(parseOutput(saved).filters).toEqual(filters);
    });

    it('rejects a PromQL tile on a source that is not a promql source', async () => {
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
        name: 'Wrong source',
        tiles: [
          {
            name: 'Up',
            config: {
              configType: 'promql',
              displayType: 'line',
              sourceId: ctx.traceSource._id.toString(),
              expressions: [{ expression: 'up' }],
            },
          },
        ],
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain(ctx.traceSource._id.toString());
    });

    it('deletes a PromQL tile left out of an update', async () => {
      const dashboard = await createStoredDashboard();

      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
        id: dashboard._id.toString(),
        name: 'PromQL dashboard',
        tiles: [
          {
            id: 'markdown-tile',
            name: 'Notes',
            config: { displayType: 'markdown', markdown: 'Notes' },
          },
        ],
        filters: [],
      });

      expect(result.isError).toBeFalsy();
      const stored = await Dashboard.findById(dashboard._id).lean();
      expect(stored?.tiles.map(t => t.id)).toEqual(['markdown-tile']);
      expect(stored?.filters).toEqual([]);
    });

    it('patches a PromQL tile', async () => {
      const dashboard = await createStoredDashboard();

      const result = await callTool(ctx.client!, 'clickstack_patch_dashboard', {
        dashboardId: dashboard._id.toString(),
        tileId: 'promql-tile',
        tile: {
          config: {
            configType: 'promql',
            displayType: 'number',
            sourceId: promqlSourceId,
            expressions: [{ expression: 'sum(up)', reducer: 'min' }],
          },
        },
      });

      expect(result.isError).toBeFalsy();
      const stored = await Dashboard.findById(dashboard._id).lean();
      expect(stored?.tiles[0].config).toMatchObject({
        configType: 'promql',
        displayType: DisplayType.Number,
        name: 'PromQL',
        promqlExpression: [{ expression: 'sum(up)', reducer: 'min' }],
      });
    });

    it('warns about a variable the dashboard does not declare', async () => {
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
        name: 'Typo',
        tiles: [
          {
            name: 'Up',
            config: {
              configType: 'promql',
              displayType: 'line',
              sourceId: promqlSourceId,
              expressions: [{ expression: 'up{job=~"$jbo"}' }],
            },
          },
        ],
        filters: [
          {
            type: 'PROMETHEUS_LABEL',
            name: 'Job',
            sourceId: promqlSourceId,
            label: 'job',
            variableName: 'job',
          },
        ],
      });

      expect(result.isError).toBeFalsy();
      const { warnings } = parseOutput(result);
      expect(warnings).toEqual([expect.stringContaining('jbo')]);
    });
  });

  describe('with PromQL disabled', () => {
    beforeEach(() => ctx.reconnect({ promqlEnabled: false }));

    it('hides PromQL tiles and label filters from clickstack_get_dashboard', async () => {
      const dashboard = await createStoredDashboard();

      const result = await callTool(ctx.client!, 'clickstack_get_dashboard', {
        id: dashboard._id.toString(),
      });

      expect(result.isError).toBeFalsy();
      const output = parseOutput(result);
      expect(output.tiles.map((t: { id: string }) => t.id)).toEqual([
        'markdown-tile',
      ]);
      expect(output.filters).toEqual([]);
    });

    it('keeps hidden tiles and label filters when clickstack_save_dashboard updates the dashboard', async () => {
      const dashboard = await createStoredDashboard();

      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
        id: dashboard._id.toString(),
        name: 'PromQL dashboard',
        tiles: [
          {
            id: 'markdown-tile',
            name: 'Updated notes',
            config: { displayType: 'markdown', markdown: 'Updated' },
          },
        ],
        filters: [
          {
            type: 'STATIC_LIST',
            name: 'Env',
            options: ['prod'],
            variableName: 'env',
          },
        ],
      });

      expect(result.isError).toBeFalsy();
      const stored = await Dashboard.findById(dashboard._id).lean();
      expect(stored?.tiles.map(t => t.id)).toEqual([
        'markdown-tile',
        'promql-tile',
      ]);
      expect(stored?.tiles[1].config).toEqual(storedPromqlTile().config);
      expect(stored?.filters?.map(f => f.type)).toEqual([
        'STATIC_LIST',
        'PROMETHEUS_LABEL',
      ]);
      expect(stored?.filters?.[1]).toMatchObject(storedLabelFilter());
    });

    it('rejects a filter whose variable name a hidden label filter already uses', async () => {
      const dashboard = await createStoredDashboard();

      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
        id: dashboard._id.toString(),
        name: 'PromQL dashboard',
        tiles: [],
        filters: [{ type: 'STATIC_LIST', name: 'Job', options: ['checkout'] }],
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('"$Job" is already used');
      const stored = await Dashboard.findById(dashboard._id).lean();
      expect(stored?.filters).toEqual([
        expect.objectContaining(storedLabelFilter()),
      ]);
      expect(stored?.tiles).toHaveLength(2);
    });

    it('rejects a PromQL tile', async () => {
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
        name: 'PromQL off',
        tiles: [
          {
            name: 'Up',
            config: {
              configType: 'promql',
              displayType: 'line',
              sourceId: promqlSourceId,
              expressions: [{ expression: 'up' }],
            },
          },
        ],
      });

      expect(result.isError).toBe(true);
      expect(await Dashboard.countDocuments({ team: ctx.team._id })).toBe(0);
    });

    it('does not patch a hidden PromQL tile', async () => {
      const dashboard = await createStoredDashboard();

      const result = await callTool(ctx.client!, 'clickstack_patch_dashboard', {
        dashboardId: dashboard._id.toString(),
        tileId: 'promql-tile',
        tile: {
          config: { displayType: 'markdown', markdown: 'Overwritten' },
        },
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('Tile not found');
      const stored = await Dashboard.findById(dashboard._id).lean();
      expect(stored?.tiles[0].config).toEqual(storedPromqlTile().config);
    });
  });
});
