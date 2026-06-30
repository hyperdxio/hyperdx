import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { RegisterToolFn } from '@/mcp/utils/registerTool';

export type McpContext = {
  teamId: string;
  userId: string;
};

export type ToolRegistrar = {
  server: McpServer;
  context: McpContext;
  registerTool: RegisterToolFn;
};

export type ToolDefinition = (registrar: ToolRegistrar) => void;

export type PromptDefinition = (server: McpServer, context: McpContext) => void;
