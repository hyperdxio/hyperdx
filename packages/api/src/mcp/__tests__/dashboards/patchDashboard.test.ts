import Dashboard from '@/models/dashboard';
import type { ExternalDashboardTileWithId } from '@/utils/zod';

import { callTool, getFirstText } from '../mcpTestUtils';
import { setupDashboardTests } from './setup';

describe('MCP Dashboard Tools - clickstack_patch_dashboard', () => {
  const ctx = setupDashboardTests();

  it('should patch a tile config without affecting other tiles', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const createResult = await callTool(
      ctx.client!,
      'clickstack_save_dashboard',
      {
        name: 'Patch Test Dashboard',
        tiles: [
          {
            name: 'Tile A',
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
            name: 'Tile B',
            x: 0,
            y: 4,
            w: 12,
            h: 4,
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
    const dashboardId = created.id;
    const tileAId = created.tiles[0].id;

    // Patch only tile A: change its name and displayType
    const patchResult = await callTool(
      ctx.client!,
      'clickstack_patch_dashboard',
      {
        dashboardId,
        tileId: tileAId,
        tile: {
          name: 'Patched Tile A',
          config: {
            displayType: 'table',
            sourceId,
            select: [{ aggFn: 'count' }],
          },
        },
      },
    );

    expect(patchResult.isError).toBeFalsy();
    const patchOutput = JSON.parse(getFirstText(patchResult));
    expect(patchOutput.patchedTile.name).toBe('Patched Tile A');
    expect(patchOutput.patchedTile.config.displayType).toBe('table');

    // Verify the full dashboard: tile B should be untouched
    const getResult = await callTool(ctx.client!, 'clickstack_get_dashboard', {
      id: dashboardId,
    });
    const dashboard = JSON.parse(getFirstText(getResult));
    expect(dashboard.tiles).toHaveLength(2);

    const tileA = dashboard.tiles.find(
      (t: ExternalDashboardTileWithId) => t.id === tileAId,
    );
    expect(tileA.name).toBe('Patched Tile A');
    expect(tileA.config.displayType).toBe('table');

    const tileB = dashboard.tiles.find(
      (t: ExternalDashboardTileWithId) => t.id !== tileAId,
    );
    expect(tileB.name).toBe('Tile B');
    expect(tileB.config.displayType).toBe('number');
  });

  it('should preserve existing layout when not specified in patch', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const createResult = await callTool(
      ctx.client!,
      'clickstack_save_dashboard',
      {
        name: 'Layout Test',
        tiles: [
          {
            name: 'Positioned Tile',
            x: 6,
            y: 10,
            w: 8,
            h: 5,
            config: {
              displayType: 'line',
              sourceId,
              select: [{ aggFn: 'count' }],
            },
          },
        ],
      },
    );
    const created = JSON.parse(getFirstText(createResult));
    const tileId = created.tiles[0].id;

    // Patch without specifying layout — layout should be preserved
    const patchResult = await callTool(
      ctx.client!,
      'clickstack_patch_dashboard',
      {
        dashboardId: created.id,
        tileId,
        tile: {
          name: 'Renamed Tile',
          config: {
            displayType: 'line',
            sourceId,
            select: [{ aggFn: 'avg', valueExpression: 'Duration' }],
          },
        },
      },
    );

    expect(patchResult.isError).toBeFalsy();
    const patched = JSON.parse(getFirstText(patchResult));
    expect(patched.patchedTile.x).toBe(6);
    expect(patched.patchedTile.y).toBe(10);
    expect(patched.patchedTile.w).toBe(8);
    expect(patched.patchedTile.h).toBe(5);
    expect(patched.patchedTile.name).toBe('Renamed Tile');
  });

  it('should update dashboard name only (no tile patch)', async () => {
    const dashboard = await new Dashboard({
      name: 'Original Name',
      tiles: [],
      team: ctx.team._id,
      tags: ['tag1'],
    }).save();

    const result = await callTool(ctx.client!, 'clickstack_patch_dashboard', {
      dashboardId: dashboard._id.toString(),
      name: 'New Name',
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(getFirstText(result));
    expect(output.name).toBe('New Name');
    expect(output.tags).toEqual(['tag1']);
    expect(output.patchedTile).toBeUndefined();

    // Verify in DB
    const updated = await Dashboard.findById(dashboard._id);
    expect(updated?.name).toBe('New Name');
  });

  it('should update tags only', async () => {
    const dashboard = await new Dashboard({
      name: 'Tag Test',
      tiles: [],
      team: ctx.team._id,
      tags: ['old'],
    }).save();

    const result = await callTool(ctx.client!, 'clickstack_patch_dashboard', {
      dashboardId: dashboard._id.toString(),
      tags: ['new1', 'new2'],
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(getFirstText(result));
    expect(output.tags).toEqual(['new1', 'new2']);
    expect(output.name).toBe('Tag Test');
  });

  it('should update name and patch tile in one call', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const createResult = await callTool(
      ctx.client!,
      'clickstack_save_dashboard',
      {
        name: 'Combo Test',
        tiles: [
          {
            name: 'A Tile',
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

    const result = await callTool(ctx.client!, 'clickstack_patch_dashboard', {
      dashboardId: created.id,
      name: 'Combo Updated',
      tileId: created.tiles[0].id,
      tile: {
        name: 'Updated Tile',
        config: {
          displayType: 'number',
          sourceId,
          select: [{ aggFn: 'avg', valueExpression: 'Duration' }],
        },
      },
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(getFirstText(result));
    expect(output.name).toBe('Combo Updated');
    expect(output.patchedTile.name).toBe('Updated Tile');
  });

  it('should return error for non-existent tileId', async () => {
    const dashboard = await new Dashboard({
      name: 'Tile Not Found',
      tiles: [],
      team: ctx.team._id,
    }).save();

    const result = await callTool(ctx.client!, 'clickstack_patch_dashboard', {
      dashboardId: dashboard._id.toString(),
      tileId: 'nonexistent',
      tile: {
        name: 'Ghost',
        config: { displayType: 'markdown', markdown: 'hello' },
      },
    });

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('Tile not found');
  });

  it('should return error for non-existent dashboard', async () => {
    const result = await callTool(ctx.client!, 'clickstack_patch_dashboard', {
      dashboardId: '000000000000000000000000',
      name: 'Ghost',
    });

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('not found');
  });

  it('should return error for missing source ID on patched tile', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const createResult = await callTool(
      ctx.client!,
      'clickstack_save_dashboard',
      {
        name: 'Source Validation Test',
        tiles: [
          {
            name: 'Valid Tile',
            config: {
              displayType: 'line',
              sourceId,
              select: [{ aggFn: 'count' }],
            },
          },
        ],
      },
    );
    const created = JSON.parse(getFirstText(createResult));

    const result = await callTool(ctx.client!, 'clickstack_patch_dashboard', {
      dashboardId: created.id,
      tileId: created.tiles[0].id,
      tile: {
        name: 'Bad Source',
        config: {
          displayType: 'line',
          sourceId: '000000000000000000000000',
          select: [{ aggFn: 'count' }],
        },
      },
    });

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('source');
  });

  it('should reject patching a tile to raw SQL with $__filters but no sourceId', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const connectionId = ctx.connection._id.toString();
    const createResult = await callTool(
      ctx.client!,
      'clickstack_save_dashboard',
      {
        name: 'SQL Macro Patch Test',
        tiles: [
          {
            name: 'Valid Tile',
            config: {
              displayType: 'line',
              sourceId,
              select: [{ aggFn: 'count' }],
            },
          },
        ],
      },
    );
    const created = JSON.parse(getFirstText(createResult));
    const tileId = created.tiles[0].id;

    const result = await callTool(ctx.client!, 'clickstack_patch_dashboard', {
      dashboardId: created.id,
      tileId,
      tile: {
        name: 'Filtered SQL',
        config: {
          configType: 'sql',
          displayType: 'table',
          connectionId,
          sqlTemplate:
            'SELECT ServiceName, count() AS c FROM otel_traces WHERE $__timeFilter(Timestamp) AND $__filters GROUP BY ServiceName LIMIT 10',
        },
      },
    });

    expect(result.isError).toBe(true);
    const text = getFirstText(result);
    expect(text).toContain('sourceId');
    expect(text).toContain('$__filters');
    expect(text).toContain('Filtered SQL');

    // The original tile must be untouched in the database.
    const dashboard = await Dashboard.findById(created.id);
    const persistedTile = dashboard?.tiles?.find(
      (t: { id: string }) => t.id === tileId,
    );
    expect(persistedTile?.config?.name).toBe('Valid Tile');
  });

  it('should allow patching a tile to raw SQL with $__filters when a sourceId is set', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const connectionId = ctx.connection._id.toString();
    const createResult = await callTool(
      ctx.client!,
      'clickstack_save_dashboard',
      {
        name: 'SQL Macro Patch Test (valid)',
        tiles: [
          {
            name: 'Valid Tile',
            config: {
              displayType: 'line',
              sourceId,
              select: [{ aggFn: 'count' }],
            },
          },
        ],
      },
    );
    const created = JSON.parse(getFirstText(createResult));

    const result = await callTool(ctx.client!, 'clickstack_patch_dashboard', {
      dashboardId: created.id,
      tileId: created.tiles[0].id,
      tile: {
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
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(getFirstText(result));
    expect(output.patchedTile.config.sourceId).toBe(sourceId);
  });

  it('should not modify other tiles in the database (positional update)', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const createResult = await callTool(
      ctx.client!,
      'clickstack_save_dashboard',
      {
        name: 'Positional Update Test',
        tiles: [
          {
            name: 'Tile A',
            x: 0,
            y: 0,
            w: 6,
            h: 3,
            config: {
              displayType: 'line',
              sourceId,
              select: [{ aggFn: 'count' }],
            },
          },
          {
            name: 'Tile B',
            x: 6,
            y: 0,
            w: 6,
            h: 3,
            config: {
              displayType: 'number',
              sourceId,
              select: [{ aggFn: 'count' }],
            },
          },
          {
            name: 'Tile C',
            x: 0,
            y: 3,
            w: 12,
            h: 4,
            config: {
              displayType: 'table',
              sourceId,
              select: [{ aggFn: 'count' }],
            },
          },
        ],
      },
    );
    const created = JSON.parse(getFirstText(createResult));
    const dashboardId = created.id;

    // Snapshot the raw tiles from the DB before patching
    const beforePatch = await Dashboard.findById(dashboardId).lean();
    const tilesBeforePatch = (beforePatch as any).tiles;
    const tileBBefore = tilesBeforePatch[1];
    const tileCBefore = tilesBeforePatch[2];

    // Patch only tile A (index 0)
    const patchResult = await callTool(
      ctx.client!,
      'clickstack_patch_dashboard',
      {
        dashboardId,
        tileId: created.tiles[0].id,
        tile: {
          name: 'Tile A Patched',
          config: {
            displayType: 'line',
            sourceId,
            select: [{ aggFn: 'avg', valueExpression: 'Duration' }],
          },
        },
      },
    );
    expect(patchResult.isError).toBeFalsy();

    // Read raw DB tiles again — tiles B and C should be byte-identical
    const afterPatch = await Dashboard.findById(dashboardId).lean();
    const tilesAfterPatch = (afterPatch as any).tiles;

    expect(tilesAfterPatch).toHaveLength(3);
    // Tile B (index 1) and Tile C (index 2) should be untouched
    expect(tilesAfterPatch[1]).toEqual(tileBBefore);
    expect(tilesAfterPatch[2]).toEqual(tileCBefore);
    // Tile A (index 0) should have changed
    expect(tilesAfterPatch[0].config.name).toBe('Tile A Patched');
  });

  it('should preserve tile name when omitted from patch (config-only patch)', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const createResult = await callTool(
      ctx.client!,
      'clickstack_save_dashboard',
      {
        name: 'Name Preservation Test',
        tiles: [
          {
            name: 'Original Title',
            config: {
              displayType: 'line',
              sourceId,
              select: [{ aggFn: 'count' }],
            },
          },
        ],
      },
    );
    const created = JSON.parse(getFirstText(createResult));
    const tileId = created.tiles[0].id;

    // Patch config only — no name field at all
    const patchResult = await callTool(
      ctx.client!,
      'clickstack_patch_dashboard',
      {
        dashboardId: created.id,
        tileId,
        tile: {
          config: {
            displayType: 'table',
            sourceId,
            select: [{ aggFn: 'avg', valueExpression: 'Duration' }],
          },
        },
      },
    );

    expect(patchResult.isError).toBeFalsy();
    const patched = JSON.parse(getFirstText(patchResult));
    expect(patched.patchedTile.name).toBe('Original Title');
    expect(patched.patchedTile.config.displayType).toBe('table');

    // Verify via get
    const getResult = await callTool(
      ctx.client!,
      'clickstack_get_dashboard_tile',
      { dashboardId: created.id, tileId },
    );
    const tile = JSON.parse(getFirstText(getResult));
    expect(tile.name).toBe('Original Title');
  });

  it('should return error when tile is removed between read and write', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const createResult = await callTool(
      ctx.client!,
      'clickstack_save_dashboard',
      {
        name: 'Concurrent Delete Test',
        tiles: [
          {
            name: 'Tile A',
            config: {
              displayType: 'line',
              sourceId,
              select: [{ aggFn: 'count' }],
            },
          },
          {
            name: 'Tile B',
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
    const tileAId = created.tiles[0].id;

    // Simulate a concurrent save_dashboard that removes tile A by
    // directly updating the DB to drop it from the array.
    await Dashboard.findByIdAndUpdate(created.id, {
      $pull: { tiles: { id: tileAId } },
    });

    // Now try to patch tile A — it no longer exists in the array.
    const patchResult = await callTool(
      ctx.client!,
      'clickstack_patch_dashboard',
      {
        dashboardId: created.id,
        tileId: tileAId,
        tile: {
          name: 'Patched A',
          config: {
            displayType: 'line',
            sourceId,
            select: [{ aggFn: 'count' }],
          },
        },
      },
    );

    expect(patchResult.isError).toBe(true);
    // Could be "Tile not found" (caught at read) or "was not found at
    // write time" (caught by positional $ miss). Either is acceptable.
    const text = getFirstText(patchResult);
    expect(text).toMatch(/not found|was not found/i);
  });

  it('should round-trip: patch then get_dashboard_tile', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const createResult = await callTool(
      ctx.client!,
      'clickstack_save_dashboard',
      {
        name: 'Round Trip Test',
        tiles: [
          {
            name: 'Original',
            config: {
              displayType: 'line',
              sourceId,
              select: [{ aggFn: 'count' }],
            },
          },
        ],
      },
    );
    const created = JSON.parse(getFirstText(createResult));
    const tileId = created.tiles[0].id;

    // Patch
    await callTool(ctx.client!, 'clickstack_patch_dashboard', {
      dashboardId: created.id,
      tileId,
      tile: {
        name: 'Patched',
        config: {
          displayType: 'number',
          sourceId,
          select: [{ aggFn: 'avg', valueExpression: 'Duration' }],
        },
      },
    });

    // Get the tile back
    const getResult = await callTool(
      ctx.client!,
      'clickstack_get_dashboard_tile',
      {
        dashboardId: created.id,
        tileId,
      },
    );

    expect(getResult.isError).toBeFalsy();
    const tile = JSON.parse(getFirstText(getResult));
    expect(tile.id).toBe(tileId);
    expect(tile.name).toBe('Patched');
    expect(tile.config.displayType).toBe('number');
    expect(tile.config.select[0].aggFn).toBe('avg');
  });

  describe('raw SQL macro warnings', () => {
    // Patching a tile to a macro-less raw SQL config succeeds (non-blocking)
    // but surfaces an advisory `warnings` array on the response.
    it('returns a non-blocking warning when a patched tile omits macros', async () => {
      const sourceId = ctx.traceSource._id.toString();
      const connectionId = ctx.connection._id.toString();
      const createResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
          name: 'Patch to static SQL',
          tiles: [
            {
              name: 'Builder Tile',
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
      const tileId = created.tiles[0].id;

      const patchResult = await callTool(
        ctx.client!,
        'clickstack_patch_dashboard',
        {
          dashboardId: created.id,
          tileId,
          tile: {
            name: 'Static SQL',
            config: {
              configType: 'sql',
              displayType: 'table',
              connectionId,
              sqlTemplate: 'SELECT 1 AS value LIMIT 1',
            },
          },
        },
      );

      // Non-blocking: the patch applies and the tile is persisted.
      expect(patchResult.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(patchResult));
      expect(output.patchedTile.name).toBe('Static SQL');
      const dashboard = await Dashboard.findById(created.id);
      const persistedConfig = dashboard?.tiles?.[0]?.config as {
        sqlTemplate?: string;
      };
      expect(persistedConfig?.sqlTemplate).toBe('SELECT 1 AS value LIMIT 1');

      expect(Array.isArray(output.warnings)).toBe(true);
      expect(output.warnings).toHaveLength(1);
      expect(output.warnings[0]).toContain('Static SQL');
      expect(output.warnings[0]).toContain('$__timeFilter');
      expect(output.warnings[0]).toContain('strongly recommended');
    });

    it('omits warnings when a patched raw SQL tile uses all recommended macros', async () => {
      const sourceId = ctx.traceSource._id.toString();
      const connectionId = ctx.connection._id.toString();
      const createResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
          name: 'Patch to macro SQL',
          tiles: [
            {
              name: 'Builder Tile',
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
      const tileId = created.tiles[0].id;

      const patchResult = await callTool(
        ctx.client!,
        'clickstack_patch_dashboard',
        {
          dashboardId: created.id,
          tileId,
          tile: {
            name: 'Macro SQL',
            config: {
              configType: 'sql',
              displayType: 'table',
              connectionId,
              sourceId,
              sqlTemplate:
                'SELECT ServiceName, count() AS c FROM $__sourceTable ' +
                'WHERE $__timeFilter(Timestamp) AND $__filters GROUP BY ServiceName LIMIT 10',
            },
          },
        },
      );

      expect(patchResult.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(patchResult));
      expect(output.warnings).toBeUndefined();
    });
  });
});
