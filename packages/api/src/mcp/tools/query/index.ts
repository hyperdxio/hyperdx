import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { McpContext, ToolDefinition } from '@/mcp/tools/types';

import { registerEventDeltas } from './eventDeltas';
import { registerEventPatterns } from './eventPatterns';
import { registerSearch } from './search';
import { registerSql } from './sql';
import { registerTable } from './table';
import { registerTimeseries } from './timeseries';

const queryTools: ToolDefinition = (server: McpServer, context: McpContext) => {
  registerTimeseries(server, context);
  registerTable(server, context);
  registerSearch(server, context);
  registerEventPatterns(server, context);
  registerEventDeltas(server, context);
  registerSql(server, context);
};

export default queryTools;
