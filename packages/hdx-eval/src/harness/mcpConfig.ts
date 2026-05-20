import type { EvalConfig } from '../hyperdx/config';
import type { McpKind } from './types';

export const MCP_CLICKHOUSE_VERSION = '0.3.0';

// Simulate a production observability backend: queries that scan the whole
// table or don't use filters/indexes time out. Forces agents to write
// efficient queries instead of `SELECT * FROM huge_table`.
export const QUERY_TIMEOUT_SECONDS = 10;

export function buildMcpConfig(
  cfg: EvalConfig,
  kind: McpKind,
): Record<string, unknown> {
  if (kind === 'hyperdx') {
    return {
      mcpServers: {
        hyperdx: {
          type: 'http',
          url: cfg.hyperdx.mcpUrl,
          headers: {
            Authorization: `Bearer ${cfg.hyperdx.accessKey}`,
          },
        },
      },
    };
  }
  return {
    mcpServers: {
      clickhouse: {
        command: 'uv',
        args: [
          'run',
          '--with',
          `mcp-clickhouse==${MCP_CLICKHOUSE_VERSION}`,
          '--python',
          '3.10',
          'mcp-clickhouse',
        ],
        env: {
          CLICKHOUSE_HOST: cfg.clickhouse.host,
          CLICKHOUSE_PORT: cfg.clickhouse.port,
          CLICKHOUSE_USER: cfg.clickhouse.user,
          CLICKHOUSE_PASSWORD: cfg.clickhouse.password,
          CLICKHOUSE_SECURE: 'false',
          CLICKHOUSE_VERIFY: 'false',
          // Tighten the client-side timeout to match the per-query
          // max_execution_time set on the HyperDX side, so both MCPs face
          // the same constraint.
          CLICKHOUSE_SEND_RECEIVE_TIMEOUT: String(QUERY_TIMEOUT_SECONDS),
        },
      },
    },
  };
}

export function allowedToolsPattern(kind: McpKind): string {
  return kind === 'hyperdx' ? 'mcp__hyperdx__*' : 'mcp__clickhouse__*';
}
