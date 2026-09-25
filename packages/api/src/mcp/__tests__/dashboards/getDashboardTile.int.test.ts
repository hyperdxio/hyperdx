import { callTool, getFirstText } from '@/mcp/__tests__/mcpTestUtils';
import Dashboard from '@/models/dashboard';

import { setupDashboardTests } from './setup';

describe('MCP Dashboard Tools - clickstack_get_dashboard_tile', () => {
  const ctx = setupDashboardTests();

  it('should return a single tile by tileId', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const createResult = await callTool(
      ctx.client!,
      'clickstack_save_dashboard',
      {
        name: 'Tile Test Dashboard',
        tiles: [
          {
            name: 'Line Chart',
            config: {
              displayType: 'line',
              sourceId,
              select: [{ aggFn: 'count' }],
            },
          },
          {
            name: 'Number Tile',
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
    const tileId = created.tiles[0].id;

    const result = await callTool(
      ctx.client!,
      'clickstack_get_dashboard_tile',
      {
        dashboardId,
        tileId,
      },
    );

    expect(result.isError).toBeFalsy();
    const wrapped = JSON.parse(getFirstText(result));
    expect(wrapped.tile.id).toBe(tileId);
    expect(wrapped.tile.name).toBe('Line Chart');
    expect(wrapped.tile.config.displayType).toBe('line');
  });

  it('wraps the tile with the dashboard id and version', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const created = JSON.parse(
      getFirstText(
        await callTool(ctx.client!, 'clickstack_save_dashboard', {
          name: 'Tile Version Dashboard',
          tiles: [
            {
              name: 'Line Chart',
              config: {
                displayType: 'line',
                sourceId,
                select: [{ aggFn: 'count' }],
              },
            },
          ],
        }),
      ),
    );
    const tileId = created.tiles[0].id;

    const result = JSON.parse(
      getFirstText(
        await callTool(ctx.client!, 'clickstack_get_dashboard_tile', {
          dashboardId: created.id,
          tileId,
        }),
      ),
    );

    expect(result.dashboardId).toBe(created.id);
    expect(result.dashboardVersion).toBe(created.version);
    expect(result.tile.id).toBe(tileId);
  });

  it('should return error for non-existent tileId', async () => {
    const dashboard = await new Dashboard({
      name: 'Empty Dashboard',
      tiles: [],
      team: ctx.team._id,
    }).save();

    const result = await callTool(
      ctx.client!,
      'clickstack_get_dashboard_tile',
      {
        dashboardId: dashboard._id.toString(),
        tileId: 'nonexistent-tile',
      },
    );

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('Tile not found');
  });

  it('should return error for non-existent dashboard', async () => {
    const result = await callTool(
      ctx.client!,
      'clickstack_get_dashboard_tile',
      {
        dashboardId: '000000000000000000000000',
        tileId: 'some-tile',
      },
    );

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('not found');
  });

  it('should return error for invalid dashboard ID', async () => {
    const result = await callTool(
      ctx.client!,
      'clickstack_get_dashboard_tile',
      {
        dashboardId: 'not-valid',
        tileId: 'some-tile',
      },
    );

    expect(result.isError).toBe(true);
    const text = getFirstText(result);
    expect(text).toContain('Invalid ObjectId');
    expect(text).toContain('dashboardId');
  });
});
