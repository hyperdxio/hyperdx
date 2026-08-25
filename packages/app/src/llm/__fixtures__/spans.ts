import { LLMSpanEvent, SpanAttributeMap } from '@/llm/lib/types';

/**
 * Realistic span-attribute fixtures per instrumentation dialect. Values are
 * strings, matching how ClickHouse `Map(String, String)` columns deliver
 * attributes to the UI.
 */

/** OTel GenAI semconv >= 1.37 (attribute-based), e.g. python openai v2. */
export const SEMCONV_ATTRIBUTES_FIXTURE: SpanAttributeMap = {
  'gen_ai.operation.name': 'chat',
  'gen_ai.provider.name': 'openai',
  'gen_ai.request.model': 'gpt-4o',
  'gen_ai.response.model': 'gpt-4o-2024-08-06',
  'gen_ai.request.temperature': '0.7',
  'gen_ai.request.max_tokens': '1024',
  'gen_ai.response.finish_reasons': '["stop"]',
  'gen_ai.usage.input_tokens': '150',
  'gen_ai.usage.output_tokens': '42',
  'gen_ai.conversation.id': 'conv-123',
  'gen_ai.system_instructions':
    '[{"type":"text","content":"You are a helpful assistant."}]',
  'gen_ai.input.messages':
    '[{"role":"user","parts":[{"type":"text","content":"What is HyperDX?"}]}]',
  'gen_ai.output.messages':
    '[{"role":"assistant","parts":[{"type":"text","content":"HyperDX is an observability platform."}],"finish_reason":"stop"}]',
};

/** OpenLLMetry (Traceloop) key-path style. */
export const OPENLLMETRY_FIXTURE: SpanAttributeMap = {
  'gen_ai.system': 'anthropic',
  'gen_ai.request.model': 'claude-sonnet-4-5',
  'gen_ai.response.model': 'claude-sonnet-4-5-20250929',
  'gen_ai.usage.prompt_tokens': '3200',
  'gen_ai.usage.completion_tokens': '180',
  'gen_ai.usage.cache_read_input_tokens': '3000',
  'llm.request.type': 'chat',
  'gen_ai.prompt.0.role': 'system',
  'gen_ai.prompt.0.content': 'You are a support bot.',
  'gen_ai.prompt.1.role': 'user',
  'gen_ai.prompt.1.content': 'Cancel my subscription',
  'gen_ai.completion.0.role': 'assistant',
  'gen_ai.completion.0.content': 'I can help with that.',
  'gen_ai.completion.0.tool_calls.0.name': 'cancel_subscription',
  'gen_ai.completion.0.tool_calls.0.arguments': '{"user_id":"u1"}',
};

/** OpenInference (Arize) key-path style. */
export const OPENINFERENCE_FIXTURE: SpanAttributeMap = {
  'openinference.span.kind': 'LLM',
  'llm.model_name': 'gpt-4o-mini',
  'llm.provider': 'openai',
  'llm.token_count.prompt': '90',
  'llm.token_count.completion': '12',
  'llm.token_count.total': '102',
  'llm.invocation_parameters': '{"temperature":0.2,"max_tokens":256}',
  'llm.input_messages.0.message.role': 'user',
  'llm.input_messages.0.message.content': 'Summarize this doc',
  'llm.output_messages.0.message.role': 'assistant',
  'llm.output_messages.0.message.content': 'Here is a summary.',
  'input.value':
    '{"messages":[{"role":"user","content":"Summarize this doc"}]}',
  'output.value': 'Here is a summary.',
};

/** Vercel AI SDK (`ai` instrumentation scope). */
export const VERCEL_AI_FIXTURE: SpanAttributeMap = {
  'ai.operationId': 'ai.generateText.doGenerate',
  'ai.model.id': 'gpt-4o',
  'ai.model.provider': 'openai.chat',
  'gen_ai.request.model': 'gpt-4o',
  'gen_ai.usage.input_tokens': '512',
  'gen_ai.usage.output_tokens': '64',
  'ai.usage.cachedInputTokens': '256',
  'ai.prompt.messages':
    '[{"role":"system","content":"Be brief."},{"role":"user","content":[{"type":"text","text":"Plan a trip"}]}]',
  'ai.response.text': 'Sure — here is a 3 day plan.',
  'ai.response.toolCalls':
    '[{"toolCallId":"call_1","toolName":"searchFlights","args":{"from":"SFO"}}]',
};

/** Event-based semconv (pre-1.37 python instrumentations / OpenLIT). */
export const SEMCONV_EVENTS_ATTRIBUTES_FIXTURE: SpanAttributeMap = {
  'gen_ai.system': 'openai',
  'gen_ai.request.model': 'gpt-4o-mini',
  'gen_ai.usage.input_tokens': '20',
  'gen_ai.usage.output_tokens': '5',
};

export const SEMCONV_EVENTS_FIXTURE: LLMSpanEvent[] = [
  {
    name: 'gen_ai.user.message',
    attributes: { 'gen_ai.event.content': '{"content":"hi there"}' },
  },
  {
    name: 'gen_ai.choice',
    attributes: {
      'gen_ai.event.content':
        '{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":"hello!"}}',
    },
  },
];

/** A plain HTTP span that must not be detected as an LLM span. */
export const NON_LLM_FIXTURE: SpanAttributeMap = {
  'http.method': 'GET',
  'http.url': 'https://api.example.com/v1/users',
  'http.status_code': '200',
};

/**
 * opencode `opencode.llm` span: OpenInference-flavored, with the message
 * arrays written as whole JSON-string attributes rather than key paths.
 * (Lifted from a real local span.)
 */
export const OPENCODE_LLM_SPAN_FIXTURE: SpanAttributeMap = {
  'agent.name': 'build',
  'agent.type': 'primary',
  cost_usd: '6.9962825',
  duration_ms: '14847',
  'gen_ai.provider.name': 'anthropic',
  'input.mime_type': 'text/plain',
  'input.value': 'check all tests',
  'llm.cost.total': '6.9962825',
  'llm.finish_reason': 'tool-calls',
  'llm.input_messages': '[{"role":"user","content":"check all tests"}]',
  'llm.model_name': 'claude-fable-5',
  'llm.provider': 'anthropic',
  'llm.system': 'anthropic',
  'llm.token_count.completion': '58',
  'llm.token_count.completion_details.reasoning': '0',
  'llm.token_count.prompt': '2',
  'llm.token_count.prompt_details.cache_read': '0',
  'llm.token_count.prompt_details.cache_write': '559469',
  'llm.token_count.total': '559529',
  'openinference.span.kind': 'LLM',
  'project.id': 'af087b34be0005ae55e4feca8f8f66aae508d2a0',
  'session.id': 'ses_fcb2d5104ffeQlRo5dkUhIxY7i',
};

/**
 * Current Vercel AI SDK root span (`ai.streamText`): camelCase `ai.usage.*`
 * keys only, session id under telemetry metadata, TTFT on the doStream span.
 */
export const VERCEL_AI_STREAMTEXT_FIXTURE: SpanAttributeMap = {
  'ai.operationId': 'ai.streamText',
  'ai.model.id': 'claude-fable-5',
  'ai.model.provider': 'anthropic',
  'ai.prompt': '{"prompt":"check all tests"}',
  'ai.response.text': 'Running the tests now.',
  'ai.response.msToFirstChunk': '4294.845166999992',
  'ai.usage.inputTokens': '337271',
  'ai.usage.outputTokens': '120',
  'ai.usage.cachedInputTokens': '335464',
  'ai.telemetry.metadata.sessionId': 'ses_fcb16cf68ffeJt01lFlHQjri5R',
  'operation.name': 'ai.streamText session.llm',
};

/**
 * Vercel AI SDK provider-call span (`ai.streamText.doStream`): carries both
 * `ai.usage.*` (incl. inputTokenDetails cache read/write splits) and
 * `gen_ai.usage.*` keys, so it passes the reported-tokens gate even though
 * the same call is also reported by an `opencode.llm` span (in a different
 * trace) when an app runs both instrumentations. (Lifted from a real local
 * span; `ai.usage.inputTokens` is inclusive of cache reads + writes, and
 * opencode's own cost for this call was $0.6792595.)
 */
export const VERCEL_AI_DOSTREAM_FIXTURE: SpanAttributeMap = {
  'ai.operationId': 'ai.streamText.doStream',
  'ai.model.id': 'claude-fable-5',
  'ai.model.provider': 'anthropic.messages',
  'ai.response.model': 'claude-fable-5',
  'ai.response.msToFirstChunk': '2612.1',
  'ai.usage.inputTokens': '650361',
  'ai.usage.outputTokens': '369',
  'ai.usage.cachedInputTokens': '649452',
  'ai.usage.inputTokenDetails.cacheReadTokens': '649452',
  'ai.usage.inputTokenDetails.cacheWriteTokens': '907',
  'ai.usage.inputTokenDetails.noCacheTokens': '2',
  'ai.usage.totalTokens': '650730',
  'gen_ai.request.model': 'claude-fable-5',
  'gen_ai.response.model': 'claude-fable-5',
  'gen_ai.system': 'anthropic.messages',
  'gen_ai.usage.input_tokens': '650361',
  'gen_ai.usage.output_tokens': '369',
  'operation.name': 'ai.streamText.doStream',
  'session.id': 'ses_fc94a96aeffeKISqSqSo2ug43g',
};

/**
 * opencode `api_request` log event: flat non-standard usage keys plus a
 * standard gen_ai provider marker.
 */
export const OPENCODE_API_REQUEST_LOG_FIXTURE: SpanAttributeMap = {
  agent: 'build',
  'agent.name': 'build',
  'agent.type': 'primary',
  cache_creation_tokens: '559469',
  cache_read_tokens: '0',
  cost_usd: '6.9962825',
  duration_ms: '14847',
  'event.name': 'api_request',
  'gen_ai.provider.name': 'anthropic',
  input_tokens: '2',
  model: 'claude-fable-5',
  output_tokens: '58',
  provider: 'anthropic',
  reasoning_tokens: '0',
  'session.id': 'ses_fcb2d5104ffeQlRo5dkUhIxY7i',
};

/**
 * Claude Code `claude_code.llm_request` span: gen_ai markers plus flat
 * snake_case usage keys and `ttft_ms`. No message content is captured.
 */
export const CLAUDE_CODE_LLM_REQUEST_FIXTURE: SpanAttributeMap = {
  attempt: '1',
  cache_creation_tokens: '0',
  cache_read_tokens: '0',
  duration_ms: '875',
  'gen_ai.request.model': 'claude-opus-5[1m]',
  'gen_ai.response.finish_reasons': '["end_turn"]',
  'gen_ai.response.id': 'req_011CeNJ8ZyY2Sq5H6Da9ZXFD',
  'gen_ai.system': 'anthropic',
  input_tokens: '528',
  llm_request_context: 'interaction',
  model: 'claude-opus-5[1m]',
  output_tokens: '17',
  'session.id': '26e92ce9-12bf-4a0a-9268-9c4e316c939c',
  'span.type': 'llm_request',
  stop_reason: 'end_turn',
  success: 'true',
  ttft_ms: '743',
};

/** Claude Code `claude_code.tool` span: no model markers, only tool ids. */
export const CLAUDE_CODE_TOOL_FIXTURE: SpanAttributeMap = {
  'gen_ai.tool.call.id': 'toolu_01SuKBn6MyQyRrLFAoWHXAM9',
  'session.id': '26e92ce9-12bf-4a0a-9268-9c4e316c939c',
  tool_name: 'Bash',
};
