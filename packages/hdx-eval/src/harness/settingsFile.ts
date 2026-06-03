import { allowedToolsPattern } from './mcpConfig';
import type { McpDefinition, PromptVariant } from './types';

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
 * Build the list of denied tools for a given MCP and prompt variant.
 * Per-MCP denied tools come from `McpDefinition.deniedTools`.
 */
export function deniedToolsFor(
  variant: PromptVariant,
  def?: McpDefinition,
): readonly string[] {
  const builtIn =
    variant === 'hypothesis'
      ? DENIED_BUILT_IN_TOOLS_BASE
      : DENIED_BUILT_IN_TOOLS;

  const mcpDenied = def?.deniedTools ?? [];
  if (mcpDenied.length > 0) {
    return [...builtIn, ...mcpDenied];
  }
  return builtIn;
}

export function buildSettings(
  def: McpDefinition,
  variant: PromptVariant = 'baseline',
  tempdir?: string,
): Record<string, unknown> {
  const allow: string[] = [allowedToolsPattern(def)];

  // Allow Read scoped to the agent's tempdir so it can recover oversized
  // tool responses that Claude Code saves to disk. The tempdir is an
  // empty mkdtemp directory — no ground truth, source, or prior runs.
  if (tempdir) {
    allow.push(`Read(${tempdir}/*)`);
  }

  return {
    permissions: {
      allow,
      deny: [...deniedToolsFor(variant, def)],
    },
  };
}
