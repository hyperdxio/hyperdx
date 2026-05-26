import Dashboard from '@/models/dashboard';
import type { ExternalDashboardTileWithId } from '@/utils/zod';

import { callTool, getFirstText } from '../mcpTestUtils';
import { setupDashboardTests } from './setup';

describe('MCP Dashboard Tools - hyperdx_patch_dashboard', () => {
  const ctx = setupDashboardTests();

  it('should patch a tile config without affecting other tiles', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const createResult = await callTool(ctx.client!, 'hyperdx_save_dashboard', {
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
    });
    const created = JSON.parse(getFirstText(createResult));
    const dashboardId = created.id;
    const tileAId = created.tiles[0].id;

    // Patch only tile A: change its name and displayType
    const patchResult = await callTool(ctx.client!, 'hyperdx_patch_dashboard', {
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
    });

    expect(patchResult.isError).toBeFalsy();
    const patchOutput = JSON.parse(getFirstText(patchResult));
    expect(patchOutput.patchedTile.name).toBe('Patched Tile A');
    expect(patchOutput.patchedTile.config.displayType).toBe('table');

    // Verify the full dashboard: tile B should be untouched
    const getResult = await callTool(ctx.client!, 'hyperdx_get_dashboard', {
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
    const createResult = await callTool(ctx.client!, 'hyperdx_save_dashboard', {
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
    });
    const created = JSON.parse(getFirstText(createResult));
    const tileId = created.tiles[0].id;

    // Patch without specifying layout — layout should be preserved
    const patchResult = await callTool(ctx.client!, 'hyperdx_patch_dashboard', {
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
    });

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

    const result = await callTool(ctx.client!, 'hyperdx_patch_dashboard', {
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

    const result = await callTool(ctx.client!, 'hyperdx_patch_dashboard', {
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
    const createResult = await callTool(ctx.client!, 'hyperdx_save_dashboard', {
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
    });
    const created = JSON.parse(getFirstText(createResult));

    const result = await callTool(ctx.client!, 'hyperdx_patch_dashboard', {
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

    const result = await callTool(ctx.client!, 'hyperdx_patch_dashboard', {
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
    const result = await callTool(ctx.client!, 'hyperdx_patch_dashboard', {
      dashboardId: '000000000000000000000000',
      name: 'Ghost',
    });

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('not found');
  });

  it('should return error for missing source ID on patched tile', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const createResult = await callTool(ctx.client!, 'hyperdx_save_dashboard', {
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
    });
    const created = JSON.parse(getFirstText(createResult));

    const result = await callTool(ctx.client!, 'hyperdx_patch_dashboard', {
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

  it('should round-trip: patch then get_dashboard_tile', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const createResult = await callTool(ctx.client!, 'hyperdx_save_dashboard', {
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
    });
    const created = JSON.parse(getFirstText(createResult));
    const tileId = created.tiles[0].id;

    // Patch
    await callTool(ctx.client!, 'hyperdx_patch_dashboard', {
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
      'hyperdx_get_dashboard_tile',
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
});
