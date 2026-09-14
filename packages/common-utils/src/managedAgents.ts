/**
 * MCP tools a managed agent may call without an approval prompt.
 *
 * Read-only only: the same MCP server also exposes clickstack_save_*,
 * clickstack_delete_* and clickstack_patch_dashboard, which must never fire
 * from an unattended investigation — no one is there to answer the prompt.
 * clickstack_sql is safe to include because that tool pins ClickHouse
 * `readonly=2`.
 *
 * Shared so the API's provisioning and the manual setup snippet the app hands
 * users cannot drift apart: an agent created either way gets the same posture.
 */
export const AUTO_ALLOWED_MCP_TOOLS = [
  'clickstack_describe_metric',
  'clickstack_describe_source',
  'clickstack_emerging_signals',
  'clickstack_event_deltas',
  'clickstack_event_patterns',
  'clickstack_get_alert',
  'clickstack_get_dashboard',
  'clickstack_get_dashboard_tile',
  'clickstack_get_saved_search',
  'clickstack_get_webhook',
  'clickstack_list_metrics',
  'clickstack_list_sources',
  'clickstack_query_tile',
  'clickstack_query_tiles',
  'clickstack_search',
  'clickstack_search_dashboards',
  'clickstack_sql',
  'clickstack_table',
  'clickstack_timeseries',
  'clickstack_trace_top_time_consuming_operations',
  'clickstack_trace_waterfall',
];

type PermissionPolicy = {
  readonly type: 'always_allow' | 'always_ask' | 'auto';
};

type AgentToolConfig = {
  readonly name: string;
  readonly enabled?: boolean;
  readonly permission_policy?: PermissionPolicy;
};

/**
 * Anthropic's built-in toolset, configured for an unattended investigation.
 *
 * Fails closed, mirroring the mcp_toolset beside it: this toolset's API
 * default is `always_allow` for every tool, so an inherited default would hand
 * a shell and a URL fetcher to a session nobody is watching — and a tool added
 * by a future toolset version would arrive auto-approved. Each tool below is a
 * decision; anything new needs one before it can run.
 *
 * Nothing here ever answers an approval prompt, so `always_ask` means "never
 * runs" and `auto` means "runs only when Anthropic's per-call evaluation
 * clears it; an indeterminate call stops that investigation".
 */
const ALWAYS_ALLOW = { type: 'always_allow' } as const;

export const AGENT_TOOLSET: {
  readonly type: string;
  readonly default_config: { readonly permission_policy: PermissionPolicy };
  readonly configs: readonly AgentToolConfig[];
} = Object.freeze({
  type: 'agent_toolset_20260401',
  default_config: Object.freeze({
    permission_policy: Object.freeze({ type: 'always_ask' as const }),
  }),
  configs: Object.freeze(
    [
      // Analysis over what the MCP tools return. The container is per-session
      // and holds only what the agent puts in it, so these reach nothing.
      { name: 'read', permission_policy: ALWAYS_ALLOW },
      { name: 'write', permission_policy: ALWAYS_ALLOW },
      { name: 'edit', permission_policy: ALWAYS_ALLOW },
      { name: 'glob', permission_policy: ALWAYS_ALLOW },
      { name: 'grep', permission_policy: ALWAYS_ALLOW },
      // An alert's note is documented as the place to link a runbook, and both
      // the standing prompt and the kickoff payload tell the agent to follow
      // it — so it needs some way to fetch one. `auto` puts every fetch
      // through Anthropic's evaluation rather than trusting the URL.
      {
        name: 'web_fetch',
        permission_policy: Object.freeze({ type: 'auto' as const }),
      },
      // Untargeted egress that nothing asks the agent to do.
      { name: 'web_search', enabled: false },
      // A shell with network access is an egress path per-call evaluation
      // cannot reliably judge: the file tools above could stage a script and
      // the shell would be asked to approve running that, not what is inside
      // it. Investigation needs querying, which the MCP tools do.
      { name: 'bash', enabled: false },
    ].map(c => Object.freeze(c)),
  ),
});
