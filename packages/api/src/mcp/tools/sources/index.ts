import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { McpContext, ToolDefinition } from '@/mcp/tools/types';

import { registerDescribeMetric } from './describeMetric';
import { registerDescribeSource } from './describeSource';
import { registerListMetrics } from './listMetrics';
import { registerListSources } from './listSources';

const sourcesTools: ToolDefinition = (
  server: McpServer,
  context: McpContext,
) => {
  registerListSources(server, context);
  registerDescribeSource(server, context);
  registerListMetrics(server, context);
  registerDescribeMetric(server, context);
};

export default sourcesTools;
