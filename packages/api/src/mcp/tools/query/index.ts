import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { McpContext, ToolDefinition } from '../types';
import { registerEventPatterns } from './eventPatterns';
import { registerSearch } from './search';
import { registerSql } from './sql';
import { registerTable } from './table';
import { registerTimeseries } from './timeseries';

export * from './schemas';

const queryTools: ToolDefinition = (server: McpServer, context: McpContext) => {
  registerTimeseries(server, context);
  registerTable(server, context);
  registerSearch(server, context);
  registerEventPatterns(server, context);
  registerSql(server, context);
};

export default queryTools;
