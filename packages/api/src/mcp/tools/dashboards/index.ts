import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { McpContext, ToolDefinition } from '@/mcp/tools/types';

import { registerDeleteDashboard } from './deleteDashboard';
import { registerGetDashboard } from './getDashboard';
import { registerGetDashboardTile } from './getDashboardTile';
import { registerPatchDashboard } from './patchDashboard';
import { registerQueryTile } from './queryTile';
import { registerSaveDashboard } from './saveDashboard';
import { registerSearchDashboards } from './searchDashboards';

export * from './schemas';

const dashboardsTools: ToolDefinition = (
  server: McpServer,
  context: McpContext,
) => {
  registerGetDashboard(server, context);
  registerGetDashboardTile(server, context);
  registerSaveDashboard(server, context);
  registerPatchDashboard(server, context);
  registerDeleteDashboard(server, context);
  registerSearchDashboards(server, context);
  registerQueryTile(server, context);
};

export default dashboardsTools;
