import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { McpContext, ToolDefinition } from '../types';
import { registerGetAlert } from './getAlert';
import { registerGetWebhook } from './getWebhook';
import { registerSaveAlert } from './saveAlert';

const alertsTools: ToolDefinition = (
  server: McpServer,
  context: McpContext,
) => {
  registerGetAlert(server, context);
  registerGetWebhook(server, context);
  registerSaveAlert(server, context);
};

export default alertsTools;
