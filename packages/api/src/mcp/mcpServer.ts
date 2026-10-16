import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Implementation } from '@modelcontextprotocol/sdk/types.js';

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

// Inlined as a data URI so the icon resolves no matter where the server is
// hosted. Mirrors packages/app/public/favicons/clickstack/favicon.svg.
const SERVER_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="260" height="260" fill="none" viewBox="0 0 260 260">' +
  '<rect width="260" height="260" fill="#F9F9F9" rx="40"/>' +
  '<g clip-path="url(#c)">' +
  '<rect width="19.499" height="175.494" x="42.25" y="42.25" fill="#151515" rx="2.051"/>' +
  '<rect width="19.499" height="175.494" x="81.251" y="42.25" fill="#151515" rx="2.051"/>' +
  '<rect width="19.499" height="175.494" x="120.252" y="42.25" fill="#151515" rx="2.051"/>' +
  '<rect width="19.499" height="175.494" x="159.243" y="42.25" fill="#151515" rx="2.051"/>' +
  '<rect width="19.499" height="38.999" x="198.254" y="110.501" fill="#151515" rx="2.051"/>' +
  '</g><defs><clipPath id="c"><path d="M26 26h208v208H26z"/></clipPath></defs></svg>';

const SERVER_INFO: Implementation = {
  name: 'clickstack',
  title: 'ClickStack',
  version: `${CODE_VERSION}-beta`,
  description:
    'Query and investigate logs, metrics, traces, and sessions stored in ' +
    'ClickHouse, and manage ClickStack dashboards, alerts, data sources, ' +
    'and saved searches.',
  websiteUrl: 'https://clickhouse.com/docs/use-cases/observability/clickstack',
  icons: [
    {
      src: `data:image/svg+xml;base64,${Buffer.from(SERVER_ICON_SVG).toString('base64')}`,
      mimeType: 'image/svg+xml',
      sizes: ['any'],
    },
  ],
};

export function createServer(context: McpContext) {
  const server = new McpServer(SERVER_INFO, {
    instructions: SERVER_INSTRUCTIONS,
  });

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
