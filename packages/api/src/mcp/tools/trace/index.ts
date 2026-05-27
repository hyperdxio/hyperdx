import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { McpContext, ToolDefinition } from '../types';
import { registerTraceBreakdown } from './breakdown';
import { registerTraceWaterfall } from './waterfall';

const traceTools: ToolDefinition = (server: McpServer, context: McpContext) => {
  registerTraceWaterfall(server, context);
  registerTraceBreakdown(server, context);
};

export default traceTools;
