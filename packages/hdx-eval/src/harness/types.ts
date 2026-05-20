export type McpKind = 'hyperdx' | 'clickhouse';

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
