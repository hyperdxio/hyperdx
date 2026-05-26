import Dashboard from '@/models/dashboard';

import { callTool, getFirstText } from '../mcpTestUtils';
import { setupDashboardTests } from './setup';

describe('MCP Dashboard Tools - hyperdx_delete_dashboard', () => {
  const ctx = setupDashboardTests();

  it('should delete an existing dashboard', async () => {
    const dashboard = await new Dashboard({
      name: 'To Delete',
      tiles: [],
      team: ctx.team._id,
    }).save();

    const result = await callTool(ctx.client!, 'hyperdx_delete_dashboard', {
      id: dashboard._id.toString(),
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(getFirstText(result));
    expect(output.deleted).toBe(true);
    expect(output.id).toBe(dashboard._id.toString());

    // Verify deleted from database
    const found = await Dashboard.findById(dashboard._id);
    expect(found).toBeNull();
  });

  it('should return error for non-existent dashboard', async () => {
    const result = await callTool(ctx.client!, 'hyperdx_delete_dashboard', {
      id: '000000000000000000000000',
    });

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('not found');
  });
});
