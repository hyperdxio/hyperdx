import type { ToolDefinition, ToolRegistrar } from '@/mcp/tools/types';

import { registerDeleteDashboard } from './deleteDashboard';
import { registerGetDashboard } from './getDashboard';
import { registerGetDashboardTile } from './getDashboardTile';
import { registerPatchDashboard } from './patchDashboard';
import { registerQueryTile } from './queryTile';
import { registerSaveDashboard } from './saveDashboard';
import { registerSearchDashboards } from './searchDashboards';

export * from './schemas';

const dashboardsTools: ToolDefinition = (registrar: ToolRegistrar) => {
  registerGetDashboard(registrar);
  registerGetDashboardTile(registrar);
  registerSaveDashboard(registrar);
  registerPatchDashboard(registrar);
  registerDeleteDashboard(registrar);
  registerSearchDashboards(registrar);
  registerQueryTile(registrar);
};

export default dashboardsTools;
