import { callTool, getFirstText } from '@/mcp/__tests__/mcpTestUtils';
import Dashboard from '@/models/dashboard';

import { setupDashboardTests } from './setup';

describe('MCP Dashboard Tools - clickstack_get_dashboard', () => {
  const ctx = setupDashboardTests();

  // Inside each test, use ctx.team, ctx.traceSource, ctx.connection, ctx.client
  // Replace bare `team` with `ctx.team`, `client` with `ctx.client!`, etc.

  it('should list all dashboards when no id provided', async () => {
    await new Dashboard({
      name: 'Dashboard 1',
      tiles: [],
      team: ctx.team._id,
      tags: ['tag1'],
    }).save();
    await new Dashboard({
      name: 'Dashboard 2',
      tiles: [],
      team: ctx.team._id,
      tags: ['tag2'],
    }).save();

    const result = await callTool(ctx.client!, 'clickstack_get_dashboard', {});

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
      team: ctx.team._id,
      tags: ['test'],
    }).save();

    const result = await callTool(ctx.client!, 'clickstack_get_dashboard', {
      id: dashboard._id.toString(),
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(getFirstText(result));
    expect(output.id).toBe(dashboard._id.toString());
    expect(output.name).toBe('My Dashboard');
    expect(output.tags).toEqual(['test']);
    expect(output.tiles).toEqual([]);
  });

  it('returns a static list filter saved outside MCP, with a derived variable name', async () => {
    // Seeded directly through the model, i.e. as the UI/REST API persists it,
    // to prove readability does not depend on the MCP save path.
    const dashboard = await new Dashboard({
      name: 'Static filter dashboard',
      tiles: [],
      team: ctx.team._id,
      filters: [
        {
          id: 'static-1',
          type: 'STATIC_LIST',
          name: 'Deploy Env',
          options: ['prod', 'staging'],
          isBroadcastEnabled: false,
          isVariableEnabled: true,
        },
      ],
    }).save();

    const result = await callTool(ctx.client!, 'clickstack_get_dashboard', {
      id: dashboard._id.toString(),
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(getFirstText(result));
    expect(output.filters[0]).toMatchObject({
      id: 'static-1',
      type: 'STATIC_LIST',
      options: ['prod', 'staging'],
      variableName: 'Deploy_Env',
    });
  });

  it('should return error for non-existent dashboard id', async () => {
    const fakeId = '000000000000000000000000';
    const result = await callTool(ctx.client!, 'clickstack_get_dashboard', {
      id: fakeId,
    });

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('not found');
  });

  it('returns a version on the detail response', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const created = JSON.parse(
      getFirstText(
        await callTool(ctx.client!, 'clickstack_save_dashboard', {
          name: 'Version Read Dashboard',
          tiles: [
            {
              name: 'Tile',
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
          ],
        }),
      ),
    );

    const detail = JSON.parse(
      getFirstText(
        await callTool(ctx.client!, 'clickstack_get_dashboard', {
          id: created.id,
        }),
      ),
    );

    expect(detail.version).toMatch(/^\d+$/);
    expect(detail.version).toBe(created.version);
  });

  it('omits version from the list response', async () => {
    const list = JSON.parse(
      getFirstText(await callTool(ctx.client!, 'clickstack_get_dashboard', {})),
    );
    expect(Array.isArray(list)).toBe(true);
    list.forEach((d: Record<string, unknown>) =>
      expect(d).not.toHaveProperty('version'),
    );
  });
});
