import { SourceKind } from '@hyperdx/common-utils/dist/types';

import {
  bulkInsertLogs,
  DEFAULT_DATABASE,
  DEFAULT_LOGS_TABLE,
} from '@/fixtures';
import { callTool, getFirstText } from '@/mcp/__tests__/mcpTestUtils';
import { Source } from '@/models/source';

import { setupDashboardTests } from './setup';

describe('MCP Dashboard Tools - clickstack_query_tiles', () => {
  const ctx = setupDashboardTests();

  const wideRange = () => ({
    startTime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    endTime: new Date().toISOString(),
  });

  const saveDashboard = async (tiles: unknown[]) => {
    const createResult = await callTool(
      ctx.client!,
      'clickstack_save_dashboard',
      { name: 'Batch Query Test', tiles },
    );
    if (createResult.isError) {
      throw new Error(getFirstText(createResult));
    }
    return JSON.parse(getFirstText(createResult));
  };

  it('should return error for non-existent dashboard', async () => {
    const result = await callTool(ctx.client!, 'clickstack_query_tiles', {
      dashboardId: '000000000000000000000000',
    });

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('not found');
  });

  it('should return error for invalid time range', async () => {
    const dashboard = await saveDashboard([
      {
        name: 'Tile',
        config: {
          displayType: 'number',
          sourceId: ctx.traceSource._id.toString(),
          select: [{ aggFn: 'count' }],
        },
      },
    ]);

    const result = await callTool(ctx.client!, 'clickstack_query_tiles', {
      dashboardId: dashboard.id,
      startTime: 'not-a-date',
    });

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('Invalid');
  });

  it('runs all non-markdown tiles by default and skips markdown', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const dashboard = await saveDashboard([
      {
        name: 'Count A',
        config: {
          displayType: 'number',
          sourceId,
          select: [{ aggFn: 'count' }],
        },
      },
      {
        name: 'Count B',
        config: {
          displayType: 'number',
          sourceId,
          select: [{ aggFn: 'count' }],
        },
      },
      {
        name: 'Notes',
        config: { displayType: 'markdown', markdown: '# hello' },
      },
    ]);

    const result = await callTool(ctx.client!, 'clickstack_query_tiles', {
      dashboardId: dashboard.id,
      ...wideRange(),
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(getFirstText(result));
    // Markdown tile is excluded from the default target set entirely.
    expect(parsed.summary.total).toBe(2);
    expect(parsed.summary.ok).toBe(2);
    expect(parsed.summary.error).toBe(0);
    expect(parsed.tiles.every((t: any) => t.status === 'ok')).toBe(true);
    const names = parsed.tiles.map((t: any) => t.name).sort();
    expect(names).toEqual(['Count A', 'Count B']);
  });

  it('runs only the requested tile IDs when provided', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const dashboard = await saveDashboard([
      {
        name: 'Count A',
        config: {
          displayType: 'number',
          sourceId,
          select: [{ aggFn: 'count' }],
        },
      },
      {
        name: 'Count B',
        config: {
          displayType: 'number',
          sourceId,
          select: [{ aggFn: 'count' }],
        },
      },
    ]);

    const targetId = dashboard.tiles[0].id;
    const result = await callTool(ctx.client!, 'clickstack_query_tiles', {
      dashboardId: dashboard.id,
      tileIds: [targetId],
      ...wideRange(),
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(getFirstText(result));
    expect(parsed.summary.total).toBe(1);
    expect(parsed.tiles).toHaveLength(1);
    expect(parsed.tiles[0].tileId).toBe(targetId);
  });

  it('reports unknown tile IDs without failing the batch', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const dashboard = await saveDashboard([
      {
        name: 'Count A',
        config: {
          displayType: 'number',
          sourceId,
          select: [{ aggFn: 'count' }],
        },
      },
    ]);

    const realId = dashboard.tiles[0].id;
    const result = await callTool(ctx.client!, 'clickstack_query_tiles', {
      dashboardId: dashboard.id,
      tileIds: [realId, 'bogus-tile-id'],
      ...wideRange(),
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(getFirstText(result));
    expect(parsed.summary.total).toBe(1);
    expect(parsed.tiles[0].tileId).toBe(realId);
    expect(parsed.tiles[0].status).toBe('ok');
    expect(parsed.unknownTileIds).toEqual(['bogus-tile-id']);
  });

  it('reports a mix of successes and failures inline, staying non-error overall', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const connectionId = ctx.connection._id.toString();
    const dashboard = await saveDashboard([
      {
        name: 'Good',
        config: {
          displayType: 'number',
          sourceId,
          select: [{ aggFn: 'count' }],
        },
      },
      {
        name: 'Bad SQL',
        config: {
          configType: 'sql',
          displayType: 'table',
          connectionId,
          sourceId,
          // References a column that does not exist -> ClickHouse error.
          sqlTemplate:
            'SELECT does_not_exist FROM $__sourceTable WHERE $__timeFilter(Timestamp) AND $__filters LIMIT 1',
        },
      },
    ]);

    const result = await callTool(ctx.client!, 'clickstack_query_tiles', {
      dashboardId: dashboard.id,
      ...wideRange(),
    });

    // One broken tile does not fail the whole call.
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(getFirstText(result));
    expect(parsed.summary.total).toBe(2);
    expect(parsed.summary.ok).toBe(1);
    expect(parsed.summary.error).toBe(1);

    const good = parsed.tiles.find((t: any) => t.name === 'Good');
    const bad = parsed.tiles.find((t: any) => t.name === 'Bad SQL');
    expect(good.status).toBe('ok');
    expect(bad.status).toBe('error');
    expect(typeof bad.error).toBe('string');
    expect(bad.error.length).toBeGreaterThan(0);
  });

  it('attaches macro warnings to a raw SQL tile that omits recommended macros', async () => {
    const connectionId = ctx.connection._id.toString();
    const dashboard = await saveDashboard([
      {
        name: 'Static SQL',
        config: {
          configType: 'sql',
          displayType: 'table',
          connectionId,
          sqlTemplate: 'SELECT 1 AS value LIMIT 1',
        },
      },
    ]);

    const result = await callTool(ctx.client!, 'clickstack_query_tiles', {
      dashboardId: dashboard.id,
      ...wideRange(),
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(getFirstText(result));
    const tile = parsed.tiles[0];
    expect(tile.status).toBe('ok');
    expect(Array.isArray(tile.warnings)).toBe(true);
    expect(tile.warnings.join(' ')).toContain('$__timeFilter');
  });

  it('reports rowCount and hasData for a tile returning rows', async () => {
    const logSource = await Source.create({
      kind: SourceKind.Log,
      team: ctx.team._id,
      from: { databaseName: DEFAULT_DATABASE, tableName: DEFAULT_LOGS_TABLE },
      timestampValueExpression: 'Timestamp',
      connection: ctx.connection._id,
      name: 'Batch Logs',
      bodyExpression: 'Body',
      severityTextExpression: 'SeverityText',
    });
    const now = new Date();
    await bulkInsertLogs([
      { Body: 'a', ServiceName: 'svc-a', SeverityText: 'INFO', Timestamp: now },
      { Body: 'b', ServiceName: 'svc-b', SeverityText: 'INFO', Timestamp: now },
    ]);

    const dashboard = await saveDashboard([
      {
        name: 'By service',
        config: {
          displayType: 'table',
          sourceId: logSource._id.toString(),
          select: [{ aggFn: 'count' }],
          groupBy: 'ServiceName',
        },
      },
    ]);

    const result = await callTool(ctx.client!, 'clickstack_query_tiles', {
      dashboardId: dashboard.id,
      startTime: new Date(now.getTime() - 60_000).toISOString(),
      endTime: new Date(now.getTime() + 60_000).toISOString(),
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(getFirstText(result));
    const tile = parsed.tiles[0];
    expect(tile.status).toBe('ok');
    expect(tile.hasData).toBe(true);
    expect(tile.rowCount).toBeGreaterThan(0);
  });

  it('reports hasData=false and rowCount=0 for a tile with no rows in range', async () => {
    const logSource = await Source.create({
      kind: SourceKind.Log,
      team: ctx.team._id,
      from: { databaseName: DEFAULT_DATABASE, tableName: DEFAULT_LOGS_TABLE },
      timestampValueExpression: 'Timestamp',
      connection: ctx.connection._id,
      name: 'Empty Batch Logs',
      bodyExpression: 'Body',
      severityTextExpression: 'SeverityText',
    });
    const dashboard = await saveDashboard([
      {
        name: 'By service',
        config: {
          displayType: 'table',
          sourceId: logSource._id.toString(),
          select: [{ aggFn: 'count' }],
          groupBy: 'ServiceName',
        },
      },
    ]);

    // Query a window far in the past where no logs exist.
    const result = await callTool(ctx.client!, 'clickstack_query_tiles', {
      dashboardId: dashboard.id,
      startTime: new Date('2000-01-01T00:00:00Z').toISOString(),
      endTime: new Date('2000-01-02T00:00:00Z').toISOString(),
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(getFirstText(result));
    const tile = parsed.tiles[0];
    expect(tile.status).toBe('ok');
    expect(tile.hasData).toBe(false);
    expect(tile.rowCount).toBe(0);
  });

  it('skips a markdown tile passed explicitly in tileIds', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const dashboard = await saveDashboard([
      {
        name: 'Count',
        config: {
          displayType: 'number',
          sourceId,
          select: [{ aggFn: 'count' }],
        },
      },
      {
        name: 'Notes',
        config: { displayType: 'markdown', markdown: '# hello' },
      },
    ]);

    const markdownTileId = dashboard.tiles.find(
      (t: any) => t.config?.displayType === 'markdown',
    ).id;

    const result = await callTool(ctx.client!, 'clickstack_query_tiles', {
      dashboardId: dashboard.id,
      tileIds: [markdownTileId],
      ...wideRange(),
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(getFirstText(result));
    expect(parsed.summary.total).toBe(1);
    expect(parsed.summary.skipped).toBe(1);
    expect(parsed.tiles).toHaveLength(1);
    expect(parsed.tiles[0].tileId).toBe(markdownTileId);
    expect(parsed.tiles[0].status).toBe('skipped');
  });

  it('deduplicates repeated tile IDs so a tile runs (and counts) once', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const dashboard = await saveDashboard([
      {
        name: 'Count',
        config: {
          displayType: 'number',
          sourceId,
          select: [{ aggFn: 'count' }],
        },
      },
    ]);

    const id = dashboard.tiles[0].id;
    const result = await callTool(ctx.client!, 'clickstack_query_tiles', {
      dashboardId: dashboard.id,
      tileIds: [id, id, id],
      ...wideRange(),
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(getFirstText(result));
    expect(parsed.summary.total).toBe(1);
    expect(parsed.tiles).toHaveLength(1);
    expect(parsed.tiles[0].tileId).toBe(id);
  });

  it('caps the batch at 50 tiles and returns the overflow as unrunTileIds', async () => {
    const sourceId = ctx.traceSource._id.toString();
    // 51 non-markdown tiles -> one over the MAX_TILES_PER_CALL cap of 50.
    const tiles = Array.from({ length: 51 }, (_, i) => ({
      name: `Count ${i}`,
      config: {
        displayType: 'number',
        sourceId,
        select: [{ aggFn: 'count' }],
      },
    }));
    const dashboard = await saveDashboard(tiles);
    const allIds = dashboard.tiles.map((t: any) => t.id);

    const result = await callTool(ctx.client!, 'clickstack_query_tiles', {
      dashboardId: dashboard.id,
      ...wideRange(),
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(getFirstText(result));
    // Exactly 50 run; the 51st is reported as unrun, in order, not dropped.
    expect(parsed.summary.total).toBe(50);
    expect(parsed.tiles).toHaveLength(50);
    expect(parsed.unrunTileIds).toEqual([allIds[50]]);
    // The run set and the unrun set partition the full selection with no gaps.
    const ranIds = parsed.tiles.map((t: any) => t.tileId);
    expect([...ranIds, ...parsed.unrunTileIds].sort()).toEqual(
      [...allIds].sort(),
    );
  });

  it('selects nothing when tileIds is an empty array (not "run everything")', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const dashboard = await saveDashboard([
      {
        name: 'Count A',
        config: {
          displayType: 'number',
          sourceId,
          select: [{ aggFn: 'count' }],
        },
      },
      {
        name: 'Count B',
        config: {
          displayType: 'number',
          sourceId,
          select: [{ aggFn: 'count' }],
        },
      },
    ]);

    const result = await callTool(ctx.client!, 'clickstack_query_tiles', {
      dashboardId: dashboard.id,
      tileIds: [],
      ...wideRange(),
    });

    // An explicit empty selection runs zero tiles rather than defaulting to
    // every non-markdown tile.
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(getFirstText(result));
    expect(parsed.summary.total).toBe(0);
    expect(parsed.tiles).toHaveLength(0);
  });

  it('rejects a tileIds array over the input cap', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const dashboard = await saveDashboard([
      {
        name: 'Count',
        config: {
          displayType: 'number',
          sourceId,
          select: [{ aggFn: 'count' }],
        },
      },
    ]);

    // 501 ids exceeds the MAX_TILE_IDS_INPUT schema cap of 500.
    const tooMany = Array.from({ length: 501 }, (_, i) => `id-${i}`);
    const result = await callTool(ctx.client!, 'clickstack_query_tiles', {
      dashboardId: dashboard.id,
      tileIds: tooMany,
      ...wideRange(),
    });

    expect(result.isError).toBe(true);
  });
});
