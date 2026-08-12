import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { CODE_VERSION } from '@/config';

import dashboardPrompts from './prompts/dashboards/index';
import alertsTools from './tools/alerts/index';
import dashboardsTools from './tools/dashboards/index';
import {
  BUILDER_TOOLS_LIST,
  SQL_FALLBACK_CRITERIA,
} from './tools/query/builderCatalog';
import queryTools from './tools/query/index';
import savedSearchesTools from './tools/savedSearches/index';
import sourcesTools from './tools/sources/index';
import traceTools from './tools/trace/index';
import { McpContext } from './tools/types';
import { createRegisterTool } from './utils/registerTool';

const SERVER_INSTRUCTIONS = [
  'ClickStack observability MCP server for querying logs, metrics, traces, and',
  'sessions, and for managing dashboards, alerts, sources, and saved searches.',
  '',
  'TOOL SELECTION POLICY — read before querying:',
  'Default to the builder query tools. They are more reliable and produce',
  'structured, chart-ready results:',
  BUILDER_TOOLS_LIST,
  '',
  'Do NOT reach for clickstack_sql first. Raw SQL is a last resort, reserved for',
  `queries the builder tools genuinely cannot express — ${SQL_FALLBACK_CRITERIA}.`,
  'A single-source aggregation, top-N, time-series, or row browse must always',
  'use a builder tool.',
  '',
  'Discovery flow: clickstack_list_sources → clickstack_describe_source → query.',
  'Fetch the query_guide prompt for detailed syntax, and create_dashboard for',
  'dashboard authoring.',
].join('\n');

export function createServer(context: McpContext) {
  const server = new McpServer(
    {
      name: 'clickstack',
      version: `${CODE_VERSION}-beta`,
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  const registerTool = createRegisterTool(server, context);
  const registrar = { server, context, registerTool };

  sourcesTools(registrar);
  alertsTools(registrar);
  dashboardsTools(registrar);
  queryTools(registrar);
  savedSearchesTools(registrar);
  traceTools(registrar);
  dashboardPrompts(server, context);

  return server;
}
