import { makeTraceSource } from '@/llm/__fixtures__/sources';
import { SEMCONV_ATTRIBUTES_FIXTURE } from '@/llm/__fixtures__/spans';
import { getLLMRowData, getRowAttributes } from '@/llm/lib/rowData';

/** Expected messages carry sequential ids, mirroring extractConversation. */
const withIds = <T>(messages: T[]) => messages.map((m, id) => ({ ...m, id }));

const TRACE_SOURCE = makeTraceSource();

describe('getRowAttributes', () => {
  it('prefers the __hdx_event_attributes alias', () => {
    const attributes = getRowAttributes(TRACE_SOURCE, {
      __hdx_event_attributes: { 'gen_ai.system': 'openai' },
      SpanAttributes: { other: 'value' },
    });
    expect(attributes).toEqual({ 'gen_ai.system': 'openai' });
  });

  it('falls back to the raw attribute column', () => {
    const attributes = getRowAttributes(TRACE_SOURCE, {
      SpanAttributes: { 'gen_ai.system': 'openai' },
    });
    expect(attributes).toEqual({ 'gen_ai.system': 'openai' });
  });

  it('returns undefined for missing rows', () => {
    expect(getRowAttributes(TRACE_SOURCE, undefined)).toBeUndefined();
    expect(getRowAttributes(TRACE_SOURCE, {})).toBeUndefined();
  });
});

describe('getLLMRowData', () => {
  it('extracts info and conversation from an LLM row', () => {
    const result = getLLMRowData(TRACE_SOURCE, {
      __hdx_event_attributes: SEMCONV_ATTRIBUTES_FIXTURE,
    });
    expect(result.isLLM).toBe(true);
    expect(result.info?.model).toBe('gpt-4o-2024-08-06');
    expect(result.conversation?.messages.length).toBeGreaterThan(0);
  });

  it('reads span events from the __hdx_span_events alias', () => {
    const result = getLLMRowData(TRACE_SOURCE, {
      __hdx_event_attributes: {},
      __hdx_span_events: [
        {
          Name: 'gen_ai.user.message',
          Attributes: { 'gen_ai.event.content': '{"content":"hi"}' },
        },
      ],
    });
    expect(result.isLLM).toBe(true);
    expect(result.conversation?.messages).toEqual(
      withIds([{ role: 'user', content: 'hi', source: 'input' }]),
    );
  });

  it('returns isLLM=false for non-LLM rows', () => {
    const result = getLLMRowData(TRACE_SOURCE, {
      __hdx_event_attributes: { 'http.method': 'GET' },
    });
    expect(result).toEqual({
      isLLM: false,
      info: undefined,
      conversation: undefined,
    });
  });
});
