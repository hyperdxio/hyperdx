import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { McpContext, ToolDefinition } from '../types';
import { registerDeleteDashboard } from './deleteDashboard';
import { registerGetDashboard } from './getDashboard';
import { registerListSources } from './listSources';
import { registerQueryTile } from './queryTile';
import { registerSaveDashboard } from './saveDashboard';

export * from './schemas';

const dashboardsTools: ToolDefinition = (
  server: McpServer,
  context: McpContext,
) => {
  registerListSources(server, context);
  registerGetDashboard(server, context);
  registerSaveDashboard(server, context);
  registerDeleteDashboard(server, context);
  registerQueryTile(server, context);
};

export default dashboardsTools;
