import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { CODE_VERSION } from '@/config';

import dashboardPrompts from './prompts/dashboards';
import dashboardsTools from './tools/dashboards';
import queryTools from './tools/query';
import { McpContext } from './tools/types';

export function createServer(context: McpContext) {
  const server = new McpServer({
    name: 'hyperdx',
    version: `${CODE_VERSION}-beta`,
  });

  dashboardsTools(server, context);
  queryTools(server, context);
  dashboardPrompts(server, context);

  return server;
}
