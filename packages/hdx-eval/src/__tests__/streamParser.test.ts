import { chunkToLines, parseStreamLine } from '@/harness/streamParser';

describe('parseStreamLine', () => {
  it('returns null for blank/invalid input', () => {
    expect(parseStreamLine('')).toBeNull();
    expect(parseStreamLine('   ')).toBeNull();
    expect(parseStreamLine('not json')).toBeNull();
    expect(parseStreamLine('null')).toBeNull();
  });

  it('parses a system init event', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'init',
      session_id: 'abc-123',
      model: 'claude-sonnet-4-6',
      tools: [
        { name: 'mcp__hyperdx__hyperdx_query', description: 'Query' },
        'plain_string_tool',
      ],
    });
    const ev = parseStreamLine(line);
    expect(ev?.kind).toBe('system_init');
    if (ev?.kind !== 'system_init') throw new Error('type narrow');
    expect(ev.sessionId).toBe('abc-123');
    expect(ev.model).toBe('claude-sonnet-4-6');
    expect(ev.tools).toHaveLength(2);
    expect(ev.tools?.[0]?.name).toBe('mcp__hyperdx__hyperdx_query');
    expect(ev.tools?.[1]?.name).toBe('plain_string_tool');
  });

  it('parses an assistant message with text + tool_use blocks', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Looking up sources' },
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'mcp__hyperdx__hyperdx_list_sources',
            input: {},
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    });
    const ev = parseStreamLine(line);
    expect(ev?.kind).toBe('assistant_message');
    if (ev?.kind !== 'assistant_message') throw new Error('type narrow');
    expect(ev.content).toHaveLength(2);
    expect(ev.usage?.input_tokens).toBe(100);
  });

  it('parses a user (tool_result) event', () => {
    const line = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_1',
            content: 'OK',
          },
        ],
      },
    });
    const ev = parseStreamLine(line);
    expect(ev?.kind).toBe('user_message');
    if (ev?.kind !== 'user_message') throw new Error('type narrow');
    expect(ev.content).toHaveLength(1);
  });

  it('parses a final result event', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 12345,
      total_cost_usd: 0.0123,
      result: 'Root cause is payment-service.',
      usage: {
        input_tokens: 5000,
        output_tokens: 200,
        cache_read_input_tokens: 1000,
      },
    });
    const ev = parseStreamLine(line);
    expect(ev?.kind).toBe('result');
    if (ev?.kind !== 'result') throw new Error('type narrow');
    expect(ev.subtype).toBe('success');
    expect(ev.isError).toBe(false);
    expect(ev.totalCostUsd).toBe(0.0123);
    expect(ev.usage?.cache_read_input_tokens).toBe(1000);
  });

  it('classifies an unknown event type without throwing', () => {
    const line = JSON.stringify({ type: 'futuristic_event', payload: 42 });
    const ev = parseStreamLine(line);
    expect(ev?.kind).toBe('unknown');
  });
});

describe('chunkToLines', () => {
  it('splits a complete buffer into lines with empty remainder', () => {
    const { events, remainder } = chunkToLines('', 'a\nb\nc\n');
    expect(events).toEqual(['a', 'b', 'c']);
    expect(remainder).toBe('');
  });

  it('preserves the trailing partial line as remainder', () => {
    const { events, remainder } = chunkToLines('', 'a\nb\npart');
    expect(events).toEqual(['a', 'b']);
    expect(remainder).toBe('part');
  });

  it('combines a leftover buffer with the new chunk', () => {
    const r1 = chunkToLines('', '{"a":');
    expect(r1.events).toHaveLength(0);
    expect(r1.remainder).toBe('{"a":');
    const r2 = chunkToLines(r1.remainder, '1}\n{"b":2}\n');
    expect(r2.events).toEqual(['{"a":1}', '{"b":2}']);
    expect(r2.remainder).toBe('');
  });
});
