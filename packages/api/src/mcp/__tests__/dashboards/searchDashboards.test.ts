import mongoose from 'mongoose';

import Dashboard from '@/models/dashboard';

import { callTool, getFirstText } from '../mcpTestUtils';
import { setupDashboardTests } from './setup';

describe('MCP Dashboard Tools - hyperdx_search_dashboards', () => {
  const ctx = setupDashboardTests();

  it('should find dashboards by name (case-insensitive)', async () => {
    await new Dashboard({
      name: 'Service Overview',
      tiles: [],
      team: ctx.team._id,
      tags: [],
    }).save();
    await new Dashboard({
      name: 'Error Dashboard',
      tiles: [],
      team: ctx.team._id,
      tags: [],
    }).save();
    await new Dashboard({
      name: 'service metrics',
      tiles: [],
      team: ctx.team._id,
      tags: [],
    }).save();

    const result = await callTool(ctx.client!, 'hyperdx_search_dashboards', {
      query: 'service',
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(getFirstText(result));
    expect(output).toHaveLength(2);
    expect(output.map((d: { name: string }) => d.name).sort()).toEqual([
      'Service Overview',
      'service metrics',
    ]);
  });

  it('should find dashboards by tags', async () => {
    await new Dashboard({
      name: 'Dashboard A',
      tiles: [],
      team: ctx.team._id,
      tags: ['production', 'backend'],
    }).save();
    await new Dashboard({
      name: 'Dashboard B',
      tiles: [],
      team: ctx.team._id,
      tags: ['production', 'frontend'],
    }).save();
    await new Dashboard({
      name: 'Dashboard C',
      tiles: [],
      team: ctx.team._id,
      tags: ['staging'],
    }).save();

    const result = await callTool(ctx.client!, 'hyperdx_search_dashboards', {
      tags: ['production'],
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(getFirstText(result));
    expect(output).toHaveLength(2);

    // Search with multiple tags (AND)
    const result2 = await callTool(ctx.client!, 'hyperdx_search_dashboards', {
      tags: ['production', 'backend'],
    });

    const output2 = JSON.parse(getFirstText(result2));
    expect(output2).toHaveLength(1);
    expect(output2[0].name).toBe('Dashboard A');
  });

  it('should combine name and tags filters', async () => {
    await new Dashboard({
      name: 'API Service',
      tiles: [],
      team: ctx.team._id,
      tags: ['production'],
    }).save();
    await new Dashboard({
      name: 'API Errors',
      tiles: [],
      team: ctx.team._id,
      tags: ['staging'],
    }).save();
    await new Dashboard({
      name: 'Web Service',
      tiles: [],
      team: ctx.team._id,
      tags: ['production'],
    }).save();

    const result = await callTool(ctx.client!, 'hyperdx_search_dashboards', {
      query: 'API',
      tags: ['production'],
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(getFirstText(result));
    expect(output).toHaveLength(1);
    expect(output[0].name).toBe('API Service');
  });

  it('should return empty array when no dashboards match', async () => {
    await new Dashboard({
      name: 'Unrelated',
      tiles: [],
      team: ctx.team._id,
    }).save();

    const result = await callTool(ctx.client!, 'hyperdx_search_dashboards', {
      query: 'nonexistent-dashboard-name',
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(getFirstText(result));
    expect(output).toHaveLength(0);
  });

  it('should only return dashboards for the current team', async () => {
    await new Dashboard({
      name: 'My Dashboard',
      tiles: [],
      team: ctx.team._id,
    }).save();
    // Create a dashboard for a different team
    const otherTeamId = new mongoose.Types.ObjectId();
    await new Dashboard({
      name: 'My Dashboard',
      tiles: [],
      team: otherTeamId,
    }).save();

    const result = await callTool(ctx.client!, 'hyperdx_search_dashboards', {
      query: 'My Dashboard',
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(getFirstText(result));
    expect(output).toHaveLength(1);
  });
});
