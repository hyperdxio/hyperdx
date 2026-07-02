import type { McpDefinition, McpKind } from './types';

// Simulate a production observability backend: queries that scan the whole
// table or don't use filters/indexes time out. Forces agents to write
// efficient queries instead of `SELECT * FROM huge_table`.
export const QUERY_TIMEOUT_SECONDS = 10;

/**
 * Build the Claude Code MCP config JSON for a single MCP definition.
 * The server name inside `mcpServers` is set to the MCP's config key
 * so that tool names match the expected `mcp__<key>__*` pattern.
 */
export function buildMcpConfig(
  def: McpDefinition,
  kind: McpKind,
): Record<string, unknown> {
  if (def.type === 'http') {
    return {
      mcpServers: {
        [kind]: {
          type: 'http',
          url: def.url,
          ...(def.headers ? { headers: def.headers } : {}),
        },
      },
    };
  }
  // stdio transport
  return {
    mcpServers: {
      [kind]: {
        command: def.command,
        ...(def.args ? { args: def.args } : {}),
        ...(def.env ? { env: def.env } : {}),
      },
    },
  };
}

/**
 * Return the tool glob pattern for a given MCP definition.
 */
export function allowedToolsPattern(def: McpDefinition): string {
  return def.toolPattern;
}
