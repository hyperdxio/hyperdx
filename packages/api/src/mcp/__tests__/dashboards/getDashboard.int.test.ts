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

  it('should return error for non-existent dashboard id', async () => {
    const fakeId = '000000000000000000000000';
    const result = await callTool(ctx.client!, 'clickstack_get_dashboard', {
      id: fakeId,
    });

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('not found');
  });
});
