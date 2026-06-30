import type {
  McpServer,
  ToolCallback,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { AnyZodObject } from 'zod';

import type { McpContext } from '@/mcp/tools/types';

import type { ToolResult } from './tracing';
import { withToolTracing } from './tracing';

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
    annotations?: ToolAnnotations;
  },
  handler: (args: TSchema['_output']) => Promise<ToolResult>,
) => void;

/**
 * Creates a `registerTool` function bound to a specific server and context.
 * The returned function automatically wraps every handler with
 * `withToolTracing`, so individual tool files don't need to import or call
 * tracing utilities.
 */
export function createRegisterTool(
  server: McpServer,
  context: McpContext,
): RegisterToolFn {
  return (name, config, handler) => {
    // Wrap with tracing, then register.  The explicit InputArgs generic
    // binds the SDK's own type parameter to AnyZodObject so TypeScript
    // resolves ToolCallback via the AnySchema branch of BaseToolCallback.
    // This lets it accept our traced callback without a type assertion —
    // both sides reduce to (args: SchemaOutput<AnyZodObject>, extra) => ….
    const traced: ToolCallback<AnyZodObject> = withToolTracing(
      name,
      context,
      handler,
    );
    server.registerTool<AnyZodObject, AnyZodObject>(name, config, traced);
  };
}
