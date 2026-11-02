import { DisplayType } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';

import { callTool, getFirstText } from '@/mcp/__tests__/mcpTestUtils';
import Dashboard from '@/models/dashboard';

import { setupDashboardTests } from './setup';

// MCP cannot edit PromQL tiles until HDX-5302, so it hides them on read and
// keeps them on save. Remove with that work.
describe('MCP Dashboard Tools - PromQL tiles', () => {
  const ctx = setupDashboardTests();

  const promqlTile = {
    id: 'promql-tile',
    x: 0,
    y: 0,
    w: 6,
    h: 3,
    config: {
      configType: 'promql',
      name: 'PromQL',
      displayType: DisplayType.Line,
      source: new mongoose.Types.ObjectId().toString(),
      promqlExpression: [{ expression: 'up' }],
    },
  };

  const markdownTile = {
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

  const createDashboard = () =>
    new Dashboard({
      name: 'PromQL dashboard',
      tiles: [promqlTile, markdownTile],
      team: ctx.team._id,
    }).save();

  it('hides PromQL tiles from clickstack_get_dashboard', async () => {
    const dashboard = await createDashboard();

    const result = await callTool(ctx.client!, 'clickstack_get_dashboard', {
      id: dashboard._id.toString(),
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(getFirstText(result));
    expect(output.tiles.map((t: { id: string }) => t.id)).toEqual([
      'markdown-tile',
    ]);
  });

  it('keeps PromQL tiles when clickstack_save_dashboard updates the dashboard', async () => {
    const dashboard = await createDashboard();

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
    });

    expect(result.isError).toBeFalsy();
    const stored = await Dashboard.findById(dashboard._id).lean();
    expect(stored?.tiles.map(t => t.id)).toEqual([
      'markdown-tile',
      'promql-tile',
    ]);
    expect(stored?.tiles[1].config).toEqual(promqlTile.config);
  });
});
