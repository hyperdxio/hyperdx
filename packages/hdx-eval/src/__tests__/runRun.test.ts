import { assembleRecord } from '../harness/runRun';
import type { ParsedEvent } from '../harness/streamParser';

function event(raw: object): ParsedEvent | null {
  // Round-trip through the JSON parser so we exercise the same code path
  // the runtime would.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { parseStreamLine } = require('../harness/streamParser');
  return parseStreamLine(JSON.stringify(raw));
}

function evs(...raws: object[]): ParsedEvent[] {
  return raws.map(r => event(r)).filter((e): e is ParsedEvent => e !== null);
}

const baseInput = {
  scenario: 'error-root-cause',
  agentPrompt: 'find root cause',
  systemPromptAppend: 'sys',
  mcp: 'hyperdx' as const,
  model: 'claude-sonnet-4-6',
  runIndex: 0,
  seed: 42,
  startedAtIso: '2026-05-09T10:00:00.000Z',
  endedAtIso: '2026-05-09T10:01:30.000Z',
  durationMs: 90_000,
  stderr: '',
};

describe('assembleRecord', () => {
  it('builds a successful run with one tool call and a final answer', () => {
    const events = evs(
      {
        type: 'system',
        subtype: 'init',
        session_id: 's1',
        tools: [{ name: 'mcp__hyperdx__hyperdx_query' }],
      },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'looking up' },
            {
              type: 'tool_use',
              id: 'tu_1',
              name: 'mcp__hyperdx__hyperdx_query',
              input: { sql: 'SELECT 1' },
            },
          ],
          usage: { input_tokens: 100, output_tokens: 25 },
        },
      },
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tu_1', content: 'rows...' },
          ],
        },
      },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Root cause is payment-service.' }],
        },
      },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 90_000,
        total_cost_usd: 0.05,
        result: 'Root cause is payment-service.',
        usage: {
          input_tokens: 5000,
          output_tokens: 200,
          cache_read_input_tokens: 1500,
        },
      },
    );

    const record = assembleRecord({
      ...baseInput,
      events,
      exitCode: 0,
      timedOut: false,
    });
    expect(record.termination).toBe('final_answer');
    expect(record.toolCalls).toHaveLength(1);
    expect(record.toolCalls[0].name).toBe('mcp__hyperdx__hyperdx_query');
    expect(record.toolCalls[0].output).toBe('rows...');
    expect(record.tokens.input).toBe(5000);
    expect(record.tokens.cacheRead).toBe(1500);
    expect(record.totalCostUsd).toBe(0.05);
    expect(record.finalAnswer).toBe('Root cause is payment-service.');
    expect(record.tools.map(t => t.name)).toEqual([
      'mcp__hyperdx__hyperdx_query',
    ]);
  });

  it('marks termination as max_turns when result subtype indicates it', () => {
    const events = evs({
      type: 'result',
      subtype: 'error_max_turns',
      is_error: true,
      result: '',
      usage: { input_tokens: 10, output_tokens: 0 },
    });
    const record = assembleRecord({
      ...baseInput,
      events,
      exitCode: 0,
      timedOut: false,
    });
    expect(record.termination).toBe('max_turns');
  });

  it('marks termination as timeout when killed', () => {
    const record = assembleRecord({
      ...baseInput,
      events: [],
      exitCode: null,
      timedOut: true,
    });
    expect(record.termination).toBe('timeout');
  });

  it('marks termination as error on non-zero exit with no answer', () => {
    const record = assembleRecord({
      ...baseInput,
      events: [],
      exitCode: 1,
      timedOut: false,
    });
    expect(record.termination).toBe('error');
  });
});
