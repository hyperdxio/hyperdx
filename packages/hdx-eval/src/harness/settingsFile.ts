import { allowedToolsPattern } from './mcpConfig';
import type { McpKind, PromptVariant } from './types';

/**
 * Filesystem / shell / built-in tools we never want the eval agent to use.
 * The agent's working directory is a fresh tempdir (no answer key) — but
 * Bash/Glob/Grep would still let it shell out to /home/ and read prior
 * runs or the source tree. Lock it to the MCP tools only.
 *
 * Read is NOT denied here — it is allowed with a path scope restricted to
 * the agent's tempdir so the agent can recover oversized tool responses
 * that Claude Code saves to disk. The scoped allow rule is added in
 * buildSettings() using the concrete tempdir path.
 *
 * `Task` (Claude Code's subagent-spawning tool) is denied by default but
 * ALLOWED in the `hypothesis` prompt variant — that variant explicitly
 * asks the agent to spawn parallel subagents to investigate multiple
 * hypotheses concurrently.
 */
export const DENIED_BUILT_IN_TOOLS_BASE = [
  'Bash',
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'TodoWrite',
] as const;

/** Retained for backward-compatibility with the existing claudeSpawn import. */
export const DENIED_BUILT_IN_TOOLS = [
  ...DENIED_BUILT_IN_TOOLS_BASE,
  'Task',
] as const;

/**
 * HyperDX MCP tools that are irrelevant to eval investigation scenarios.
 * Denying these reduces the total visible tool count so Claude Code is more
 * likely to load schemas eagerly (instead of deferring them behind
 * ToolSearch), saving 1-2 turns per run.
 */
const DENIED_HYPERDX_NON_INVESTIGATION_TOOLS = [
  'mcp__hyperdx__hyperdx_delete_dashboard',
  'mcp__hyperdx__hyperdx_get_dashboard',
  'mcp__hyperdx__hyperdx_save_dashboard',
  'mcp__hyperdx__hyperdx_query_tile',
  'mcp__hyperdx__hyperdx_get_saved_search',
  'mcp__hyperdx__hyperdx_save_saved_search',
  'mcp__hyperdx__hyperdx_get_alert',
  'mcp__hyperdx__hyperdx_get_webhook',
  'mcp__hyperdx__hyperdx_save_alert',
] as const;

export function deniedToolsFor(
  variant: PromptVariant,
  kind?: McpKind,
): readonly string[] {
  const builtIn =
    variant === 'hypothesis'
      ? DENIED_BUILT_IN_TOOLS_BASE
      : DENIED_BUILT_IN_TOOLS;

  if (kind === 'hyperdx') {
    return [...builtIn, ...DENIED_HYPERDX_NON_INVESTIGATION_TOOLS];
  }
  return builtIn;
}

export function buildSettings(
  kind: McpKind,
  variant: PromptVariant = 'baseline',
  tempdir?: string,
): Record<string, unknown> {
  const allow: string[] = [allowedToolsPattern(kind)];

  // Allow Read scoped to the agent's tempdir so it can recover oversized
  // tool responses that Claude Code saves to disk. The tempdir is an
  // empty mkdtemp directory — no ground truth, source, or prior runs.
  if (tempdir) {
    allow.push(`Read(${tempdir}/*)`);
  }

  return {
    permissions: {
      allow,
      deny: [...deniedToolsFor(variant, kind)],
    },
  };
}
