import {
  NON_LLM_FIXTURE,
  OPENINFERENCE_FIXTURE,
  OPENLLMETRY_FIXTURE,
  SEMCONV_ATTRIBUTES_FIXTURE,
  SEMCONV_EVENTS_ATTRIBUTES_FIXTURE,
  SEMCONV_EVENTS_FIXTURE,
  VERCEL_AI_FIXTURE,
} from '@/llm/__fixtures__/spans';
import { extractConversation } from '@/llm/lib/messages';

/** Expected messages carry sequential ids, mirroring extractConversation. */
const withIds = <T>(messages: T[]) => messages.map((m, id) => ({ ...m, id }));

describe('extractConversation', () => {
  it('returns undefined when no adapter matches', () => {
    expect(extractConversation(NON_LLM_FIXTURE)).toBeUndefined();
    expect(extractConversation({})).toBeUndefined();
    expect(extractConversation(undefined)).toBeUndefined();
  });

  it('normalizes semconv attribute-based messages (parts format)', () => {
    const conversation = extractConversation(SEMCONV_ATTRIBUTES_FIXTURE);
    expect(conversation?.dialect).toBe('semconv-attributes');
    expect(conversation?.messages).toEqual(
      withIds([
        {
          role: 'system',
          content: 'You are a helpful assistant.',
          source: 'input',
        },
        { role: 'user', content: 'What is HyperDX?', source: 'input' },
        {
          role: 'assistant',
          content: 'HyperDX is an observability platform.',
          source: 'output',
        },
      ]),
    );
  });

  it('reconstructs OpenLLMetry key-path messages with tool calls', () => {
    const conversation = extractConversation(OPENLLMETRY_FIXTURE);
    expect(conversation?.dialect).toBe('openllmetry');
    expect(conversation?.messages).toHaveLength(3);
    expect(conversation?.messages[0]).toEqual({
      id: 0,
      role: 'system',
      content: 'You are a support bot.',
      source: 'input',
    });
    expect(conversation?.messages[2]).toMatchObject({
      role: 'assistant',
      content: 'I can help with that.',
      source: 'output',
      toolCalls: [
        { name: 'cancel_subscription', arguments: '{"user_id":"u1"}' },
      ],
    });
  });

  it('reconstructs OpenInference key-path messages', () => {
    const conversation = extractConversation(OPENINFERENCE_FIXTURE);
    expect(conversation?.dialect).toBe('openinference');
    expect(conversation?.messages).toEqual(
      withIds([
        { role: 'user', content: 'Summarize this doc', source: 'input' },
        { role: 'assistant', content: 'Here is a summary.', source: 'output' },
      ]),
    );
  });

  it('falls back to input.value/output.value for OpenInference chain spans', () => {
    const conversation = extractConversation({
      'openinference.span.kind': 'CHAIN',
      'input.value': 'What can I do in Paris?',
      'output.value': 'Visit the Louvre.',
    });
    expect(conversation?.dialect).toBe('openinference');
    expect(conversation?.messages).toEqual(
      withIds([
        { role: 'user', content: 'What can I do in Paris?', source: 'input' },
        { role: 'assistant', content: 'Visit the Louvre.', source: 'output' },
      ]),
    );
  });

  it('normalizes Vercel AI SDK prompts, text and tool calls', () => {
    const conversation = extractConversation(VERCEL_AI_FIXTURE);
    expect(conversation?.dialect).toBe('vercel-ai');
    expect(conversation?.messages[0]).toEqual({
      id: 0,
      role: 'system',
      content: 'Be brief.',
      source: 'input',
    });
    expect(conversation?.messages[1]).toEqual({
      id: 1,
      role: 'user',
      content: 'Plan a trip',
      source: 'input',
    });
    expect(conversation?.messages[2]).toMatchObject({
      role: 'assistant',
      content: 'Sure — here is a 3 day plan.',
      source: 'output',
      toolCalls: [
        {
          id: 'call_1',
          name: 'searchFlights',
          arguments: '{"from":"SFO"}',
        },
      ],
    });
  });

  it('normalizes event-based semconv messages', () => {
    const conversation = extractConversation(
      SEMCONV_EVENTS_ATTRIBUTES_FIXTURE,
      SEMCONV_EVENTS_FIXTURE,
    );
    expect(conversation?.dialect).toBe('semconv-events');
    expect(conversation?.messages).toEqual(
      withIds([
        { role: 'user', content: 'hi there', source: 'input' },
        { role: 'assistant', content: 'hello!', source: 'output' },
      ]),
    );
  });

  it('handles OpenLIT-style content events', () => {
    const conversation = extractConversation({ 'gen_ai.system': 'openai' }, [
      {
        name: 'gen_ai.content.prompt',
        attributes: { 'gen_ai.prompt': 'user: hello' },
      },
      {
        name: 'gen_ai.content.completion',
        attributes: { 'gen_ai.completion': 'hi, how can I help?' },
      },
    ]);
    expect(conversation?.dialect).toBe('semconv-events');
    expect(conversation?.messages).toEqual(
      withIds([
        { role: 'user', content: 'user: hello', source: 'input' },
        { role: 'assistant', content: 'hi, how can I help?', source: 'output' },
      ]),
    );
  });

  it('maps tool-execution spans to tool call + result messages', () => {
    const conversation = extractConversation({
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.tool.name': 'get_weather',
      'gen_ai.tool.call.arguments': '{"city":"SF"}',
      'gen_ai.tool.call.result': '{"tempC":18}',
    });
    expect(conversation?.dialect).toBe('semconv-attributes');
    expect(conversation?.messages).toEqual(
      withIds([
        {
          role: 'assistant',
          content: null,
          toolCalls: [{ name: 'get_weather', arguments: '{"city":"SF"}' }],
          source: 'input',
        },
        {
          role: 'tool',
          // Object payloads are pretty-printed for display.
          content: '{\n  "tempC": 18\n}',
          name: 'get_weather',
          source: 'output',
        },
      ]),
    );
  });
});
