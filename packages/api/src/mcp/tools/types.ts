import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { AnyZodObject } from 'zod';

import type { McpClientInfo } from '@/mcp/utils/mcpClient';

export type McpContext = {
  teamId: string;
  userId: string;
  /**
   * Identity of the calling MCP client application, parsed from User-Agent.
   */
  mcpClient?: McpClientInfo;
};

/**
 * The result shape every MCP tool handler should return.
 *
 * Intersects the SDK's `CallToolResult` (which carries an index signature
 * from the `$loose` Zod modifier) with a narrower `content` array so tool
 * handlers are constrained to text-only content blocks.
 */
export type ToolResult = CallToolResult & {
  content: { type: 'text'; text: string }[];
};

/**
 * A simplified tool registration function that wraps `server.registerTool`
 * with automatic tracing. Eliminates the need to:
 * - Pass the tool name twice (once to registerTool, once to withToolTracing)
 * - Import and manually wire up withToolTracing in every tool file
 * - Import McpServer type in every tool file
 */
export type RegisterToolFn = <TSchema extends AnyZodObject>(
  name: string,
  config: {
    title: string;
    description: string;
    inputSchema: TSchema;
  },
  handler: (args: TSchema['_output']) => Promise<ToolResult>,
) => void;

export type ToolRegistrar = {
  server: McpServer;
  context: McpContext;
  registerTool: RegisterToolFn;
};

export type ToolDefinition = (registrar: ToolRegistrar) => void;

export type PromptDefinition = (server: McpServer, context: McpContext) => void;
