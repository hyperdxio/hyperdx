import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { CODE_VERSION } from '@/config';

import dashboardPrompts from './prompts/dashboards/index';
import alertsTools from './tools/alerts/index';
import dashboardsTools from './tools/dashboards/index';
import queryTools from './tools/query/index';
import savedSearchesTools from './tools/savedSearches/index';
import sourcesTools from './tools/sources/index';
import { McpContext } from './tools/types';

export function createServer(context: McpContext) {
  const server = new McpServer({
    name: 'hyperdx',
    version: `${CODE_VERSION}-beta`,
  });

  sourcesTools(server, context);
  alertsTools(server, context);
  dashboardsTools(server, context);
  queryTools(server, context);
  savedSearchesTools(server, context);
  dashboardPrompts(server, context);

  return server;
}
