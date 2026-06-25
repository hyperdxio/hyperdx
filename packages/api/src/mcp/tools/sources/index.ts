import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { McpContext, ToolDefinition } from '@/mcp/tools/types';

import { registerDescribeSource } from './describeSource';
import { registerListSources } from './listSources';

const sourcesTools: ToolDefinition = (
  server: McpServer,
  context: McpContext,
) => {
  registerListSources(server, context);
  registerDescribeSource(server, context);
};

export default sourcesTools;
