import type { EvalConfig } from '../hyperdx/config';
import { runClaude } from './claudeSpawn';
import type { ParsedEvent } from './streamParser';
import { buildSystemPrompt } from './systemPrompt';
import type {
  McpKind,
  PromptVariant,
  RunRecord,
  Termination,
  ToolCallRecord,
} from './types';

export type RunCellOptions = {
  config: EvalConfig;
  scenario: string;
  agentPrompt: string;
  mcp: McpKind;
  model: string;
  maxTurns: number;
  timeoutMs: number;
  runIndex: number;
  seed: number;
  apiKey: string;
  /** When set, the agent's system prompt declares this ISO timestamp as the
   * fixed "now" for any relative-time reference in the user prompt. */
  anchorTimeIso?: string;
  /** Prompt variant — 'baseline' (default) or 'hypothesis' (forces
   *  hypothesis-enumeration + parallel Task subagents). */
  promptVariant?: PromptVariant;
};

export async function runCell(opts: RunCellOptions): Promise<RunRecord> {
  const startedAtIso = new Date().toISOString();
  const startedAtMs = Date.now();
  const promptVariant: PromptVariant = opts.promptVariant ?? 'baseline';
  const systemPromptAppend = buildSystemPrompt(
    opts.scenario,
    opts.mcp,
    opts.anchorTimeIso,
    promptVariant,
  );

  const result = await runClaude({
    config: opts.config,
    scenario: opts.scenario,
    mcp: opts.mcp,
    model: opts.model,
    maxTurns: opts.maxTurns,
    timeoutMs: opts.timeoutMs,
    agentPrompt: opts.agentPrompt,
    systemPromptAppend,
    apiKey: opts.apiKey,
    promptVariant,
  });

  const endedAtIso = new Date().toISOString();
  const endedAtMs = Date.now();

  return assembleRecord({
    events: result.events,
    stderr: result.stderr,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    scenario: opts.scenario,
    agentPrompt: opts.agentPrompt,
    systemPromptAppend,
    mcp: opts.mcp,
    model: opts.model,
    runIndex: opts.runIndex,
    seed: opts.seed,
    startedAtIso,
    endedAtIso,
    durationMs: endedAtMs - startedAtMs,
  });
}

type AssembleInput = {
  events: ParsedEvent[];
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  scenario: string;
  agentPrompt: string;
  systemPromptAppend: string;
  mcp: McpKind;
  model: string;
  runIndex: number;
  seed: number;
  startedAtIso: string;
  endedAtIso: string;
  durationMs: number;
};

export function assembleRecord(input: AssembleInput): RunRecord {
  const toolCalls: ToolCallRecord[] = [];
  const callsById = new Map<string, ToolCallRecord>();
  const tools: { name: string; description?: string }[] = [];
  let lastAssistantText = '';
  let resultUsage:
    | {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      }
    | undefined;
  let resultText: string | undefined;
  let resultSubtype: string | undefined;
  let resultIsError = false;
  let totalCostUsd: number | null = null;

  for (const ev of input.events) {
    if (ev.kind === 'system_init') {
      if (ev.tools) tools.push(...ev.tools);
    } else if (ev.kind === 'assistant_message') {
      const ts = new Date().toISOString();
      for (const block of ev.content) {
        if (!block || typeof block !== 'object') continue;
        const b = block as Record<string, unknown>;
        if (b.type === 'text' && typeof b.text === 'string') {
          lastAssistantText = b.text;
        } else if (b.type === 'tool_use') {
          const id = typeof b.id === 'string' ? b.id : null;
          if (!id) continue;
          const call: ToolCallRecord = {
            name: typeof b.name === 'string' ? b.name : 'unknown',
            input: b.input ?? null,
            output: null,
            isError: false,
            startedAt: ts,
            endedAt: null,
            durationMs: null,
          };
          callsById.set(id, call);
          toolCalls.push(call);
        }
      }
    } else if (ev.kind === 'user_message') {
      const ts = new Date().toISOString();
      for (const block of ev.content) {
        if (!block || typeof block !== 'object') continue;
        const b = block as Record<string, unknown>;
        if (b.type !== 'tool_result') continue;
        const id = typeof b.tool_use_id === 'string' ? b.tool_use_id : null;
        if (!id) continue;
        const call = callsById.get(id);
        if (!call) continue;
        call.output = stringifyToolResult(b.content);
        call.isError = b.is_error === true;
        call.endedAt = ts;
        const startMs = Date.parse(call.startedAt);
        const endMs = Date.parse(ts);
        if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
          call.durationMs = Math.max(0, endMs - startMs);
        }
      }
    } else if (ev.kind === 'result') {
      resultUsage = ev.usage;
      resultText = ev.resultText;
      resultSubtype = ev.subtype;
      resultIsError = ev.isError;
      if (typeof ev.totalCostUsd === 'number') totalCostUsd = ev.totalCostUsd;
    }
  }

  const finalAnswer = resultText ?? lastAssistantText;
  const termination = determineTermination({
    timedOut: input.timedOut,
    exitCode: input.exitCode,
    resultSubtype,
    resultIsError,
    hasFinalAnswer: !!finalAnswer,
  });

  return {
    schemaVersion: 1,
    runId: `${input.startedAtIso}-${input.scenario}-${input.mcp}-${input.runIndex}`,
    scenario: input.scenario,
    mcp: input.mcp,
    model: input.model,
    runIndex: input.runIndex,
    seed: input.seed,
    startedAt: input.startedAtIso,
    endedAt: input.endedAtIso,
    durationMs: input.durationMs,
    agentPrompt: input.agentPrompt,
    systemPromptAppend: input.systemPromptAppend,
    termination,
    exitCode: input.exitCode,
    tools,
    toolCalls,
    messages: input.events.map(e => e.raw),
    finalAnswer,
    tokens: {
      input: resultUsage?.input_tokens ?? 0,
      output: resultUsage?.output_tokens ?? 0,
      cacheCreation: resultUsage?.cache_creation_input_tokens ?? 0,
      cacheRead: resultUsage?.cache_read_input_tokens ?? 0,
    },
    totalCostUsd,
    stderr: input.stderr,
  };
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(c => {
        if (!c || typeof c !== 'object') return JSON.stringify(c);
        const o = c as Record<string, unknown>;
        if (typeof o.text === 'string') return o.text;
        return JSON.stringify(o);
      })
      .join('\n');
  }
  return JSON.stringify(content);
}

function determineTermination(args: {
  timedOut: boolean;
  exitCode: number | null;
  resultSubtype?: string;
  resultIsError: boolean;
  hasFinalAnswer: boolean;
}): Termination {
  if (args.timedOut) return 'timeout';
  if (args.resultSubtype === 'error_max_turns') return 'max_turns';
  if (args.resultIsError) return 'error';
  if (args.exitCode !== null && args.exitCode !== 0) return 'error';
  if (args.hasFinalAnswer) return 'final_answer';
  return 'error';
}
