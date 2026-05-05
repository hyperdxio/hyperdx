import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { CODE_VERSION } from '@/config';

import dashboardPrompts from './prompts/dashboards/index';
import dashboardsTools from './tools/dashboards/index';
import queryTools from './tools/query/index';
import { McpContext } from './tools/types';
import { registerWidget } from './ui/widget';

export function createServer(context: McpContext) {
  const server = new McpServer({
    name: 'hyperdx',
    version: `${CODE_VERSION}-beta`,
  });

  dashboardsTools(server, context);
  queryTools(server, context);
  dashboardPrompts(server, context);
  registerWidget(server);

  return server;
}
