/**
 * Blind candidate answers before showing them to the judge so the judge
 * can't tell which MCP the agent used. We replace MCP-identifying tool
 * names and brand mentions with neutral placeholders. We do NOT touch
 * data references like `payment-service` or `database.query` — those
 * are part of the answer being graded.
 */

const TOOL_PREFIX = /\bmcp__(hyperdx|clickhouse)__/gi;
const HYPERDX_TOOL_NAMES =
  /\bhyperdx_(query|list_sources|get_dashboard|save_dashboard|query_tile|delete_dashboard)\b/gi;
const CLICKHOUSE_TOOL_NAMES =
  /\b(run_query|run_select_query|list_tables|list_databases|describe_table|run_chdb_select_query)\b/gi;
const HYPERDX_BRAND = /\bHyperDX(\s+MCP)?\b/g;
const CLICKHOUSE_BRAND_MCP = /\bClickHouse\s+MCP\b/g;

export function blindAnswer(text: string): string {
  return text
    .replace(TOOL_PREFIX, 'mcp__redacted__')
    .replace(HYPERDX_TOOL_NAMES, 'mcp_query')
    .replace(CLICKHOUSE_TOOL_NAMES, 'mcp_query')
    .replace(HYPERDX_BRAND, 'MCP A')
    .replace(CLICKHOUSE_BRAND_MCP, 'MCP B');
}
