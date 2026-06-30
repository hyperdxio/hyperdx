import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { McpContext, ToolDefinition } from '@/mcp/tools/types';

import { registerGetSavedSearch } from './getSavedSearch';
import { registerSaveSavedSearch } from './saveSavedSearch';

const savedSearchesTools: ToolDefinition = (
  server: McpServer,
  context: McpContext,
) => {
  registerGetSavedSearch(server, context);
  registerSaveSavedSearch(server, context);
};

export default savedSearchesTools;
