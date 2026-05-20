import { allowedToolsPattern } from './mcpConfig';
import type { McpKind, PromptVariant } from './types';

/**
 * Filesystem / shell / built-in tools we never want the eval agent to use.
 * The agent's working directory is a fresh tempdir (no answer key) — but
 * Bash/Read/Glob/Grep would still let it shell out to /home/ and read prior
 * runs or the source tree. Lock it to the MCP tools only.
 *
 * `Task` (Claude Code's subagent-spawning tool) is denied by default but
 * ALLOWED in the `hypothesis` prompt variant — that variant explicitly
 * asks the agent to spawn parallel subagents to investigate multiple
 * hypotheses concurrently.
 */
export const DENIED_BUILT_IN_TOOLS_BASE = [
  'Bash',
  'Read',
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

export function deniedToolsFor(variant: PromptVariant): readonly string[] {
  return variant === 'hypothesis'
    ? DENIED_BUILT_IN_TOOLS_BASE
    : DENIED_BUILT_IN_TOOLS;
}

export function buildSettings(
  kind: McpKind,
  variant: PromptVariant = 'baseline',
): Record<string, unknown> {
  return {
    permissions: {
      allow: [allowedToolsPattern(kind)],
      deny: [...deniedToolsFor(variant)],
    },
  };
}
