/**
 * MCP identifier — a free-form string key matching an entry in the
 * `mcps` section of `eval.config.json`. No longer restricted to a
 * fixed union; any config-defined name is valid.
 */
export type McpKind = string;

/**
 * Transport configuration for an HTTP-based MCP server (e.g. HyperDX MCP).
 */
type HttpMcpTransport = {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
};

/**
 * Transport configuration for a stdio-based MCP server (e.g. mcp-clickhouse).
 */
type StdioMcpTransport = {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

/**
 * A single MCP definition in the eval config. Fully specifies how to
 * connect to the MCP, which tools it exposes, and how to blind its
 * identity for fair judging.
 */
export type McpDefinition = (HttpMcpTransport | StdioMcpTransport) & {
  /** Glob pattern for allowed tools, e.g. `mcp__hyperdx__*`. */
  toolPattern: string;
  /** Human-readable label for reports and CLI output. */
  label: string;
  /** Brand terms to redact when blinding answers for the LLM judge. */
  brandTerms?: string[];
  /** MCP tools to deny (e.g. non-investigation tools). */
  deniedTools?: string[];
  /** Whether this MCP is included when `--mcp all` is used. Default: true.
   *  Explicitly naming a disabled MCP via `--mcp name` still works. */
  enabled?: boolean;
};

/**
 * Prompt variants for the system-prompt A/B.
 *  - `baseline`: the default investigative prompt, no subagent affordance.
 *  - `hypothesis`: hard playbook that asks the agent to enumerate 2–4
 *    hypotheses up front, spawn a Task subagent per hypothesis to
 *    investigate in parallel, then synthesize.
 */
export type PromptVariant = 'baseline' | 'hypothesis';

export type Termination = 'final_answer' | 'max_turns' | 'timeout' | 'error';

export type ToolCallRecord = {
  name: string;
  input: unknown;
  output: string | null;
  isError: boolean;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
};

export type RunRecord = {
  schemaVersion: 1;
  runId: string;
  scenario: string;
  mcp: McpKind;
  model: string;
  runIndex: number;
  seed: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  agentPrompt: string;
  systemPromptAppend: string;
  termination: Termination;
  exitCode: number | null;
  tools: { name: string; description?: string }[];
  toolCalls: ToolCallRecord[];
  messages: unknown[];
  finalAnswer: string;
  tokens: {
    input: number;
    output: number;
    cacheCreation: number;
    cacheRead: number;
  };
  totalCostUsd: number | null;
  stderr: string;
};
