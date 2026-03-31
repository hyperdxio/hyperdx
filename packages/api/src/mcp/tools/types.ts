import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export type McpContext = {
  teamId: string;
  userId?: string;
};

export type ToolDefinition = (server: McpServer, context: McpContext) => void;
