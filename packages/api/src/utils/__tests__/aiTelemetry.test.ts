import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { generateText, isStepCount, tool } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';

import {
  createAITelemetry,
  enrichLLMSpan,
  type LLMAttribution,
  llmTelemetry,
  registerAITelemetry,
} from '@/utils/aiTelemetry';

const usage: Awaited<ReturnType<MockLanguageModelV4['doGenerate']>>['usage'] = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

// Step 1 calls a tool, step 2 answers, so the call produces operation, step,
// chat and execute_tool spans.
const createModel = () => {
  let call = 0;
  return new MockLanguageModelV4({
    provider: 'anthropic',
    modelId: 'mock-model',
    doGenerate: async () => {
      call += 1;
      return call === 1
        ? {
            content: [
              {
                type: 'tool-call',
                toolCallId: 'tc-1',
                toolName: 'lookup',
                input: '{"q":"x"}',
              },
            ],
            finishReason: { unified: 'tool-calls', raw: undefined },
            usage,
            warnings: [],
          }
        : {
            content: [{ type: 'text', text: 'done' }],
            finishReason: { unified: 'stop', raw: undefined },
            usage,
            warnings: [],
          };
    },
  });
};

const runToolCall = (telemetry: ReturnType<typeof llmTelemetry>) =>
  generateText({
    model: createModel(),
    prompt: 'hi',
    tools: {
      lookup: tool({
        inputSchema: z.object({ q: z.string() }),
        execute: async ({ q }) => ({ q }),
      }),
    },
    stopWhen: isStepCount(2),
    ...telemetry,
  });

const runTracedCall = async (attribution: LLMAttribution) => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  await runToolCall(
    llmTelemetry(attribution, {
      functionId: 'test.fn',
      integrations: createAITelemetry({ tracer: provider.getTracer('test') }),
    }),
  );
  return exporter.getFinishedSpans();
};

const operationNames = (spans: { attributes: Record<string, unknown> }[]) =>
  spans.map(s => s.attributes['gen_ai.operation.name']).sort();

describe('AI SDK OpenTelemetry integration', () => {
  it('stamps attribution onto every span of the call', async () => {
    const spans = await runTracedCall({
      sessionId: 'session-1',
      teamId: 'team-1',
      userId: 'user-1',
    });

    const operations = spans.map(s => s.attributes['gen_ai.operation.name']);
    expect(operations).toEqual(
      expect.arrayContaining(['chat', 'execute_tool']),
    );
    for (const span of spans) {
      expect(span.attributes).toMatchObject({
        'gen_ai.conversation.id': 'session-1',
        'hyperdx.team.id': 'team-1',
        'user.id': 'user-1',
      });
    }
  });

  it('omits the session attribute when only team and user are known', async () => {
    // The chart assistant has no conversation-scoped id.
    const spans = await runTracedCall({ teamId: 'team-1', userId: 'user-1' });

    expect(spans.length).toBeGreaterThan(0);
    for (const span of spans) {
      expect(span.attributes).toMatchObject({
        'hyperdx.team.id': 'team-1',
        'user.id': 'user-1',
      });
      expect(span.attributes).not.toHaveProperty('gen_ai.conversation.id');
    }
  });

  it('emits GenAI semconv attributes the LLM dashboard reads', async () => {
    const spans = await runTracedCall({ sessionId: 'session-1' });

    const chat = spans.find(
      s => s.attributes['gen_ai.operation.name'] === 'chat',
    );
    expect(chat?.attributes).toMatchObject({
      'gen_ai.provider.name': 'anthropic',
      'gen_ai.request.model': 'mock-model',
      'gen_ai.usage.input_tokens': 10,
      'gen_ai.usage.output_tokens': 5,
    });
    expect(
      spans.some(s => s.attributes['gen_ai.agent.name'] === 'test.fn'),
    ).toBe(true);

    // Message content feeds the dashboard's Messages tab.
    expect(chat?.attributes['gen_ai.input.messages']).toEqual(
      expect.stringContaining('"content":"hi"'),
    );
    expect(chat?.attributes['gen_ai.output.messages']).toEqual(
      expect.stringContaining('"name":"lookup"'),
    );
    const toolSpan = spans.find(
      s => s.attributes['gen_ai.operation.name'] === 'execute_tool',
    );
    expect(toolSpan?.attributes).toMatchObject({
      'gen_ai.tool.name': 'lookup',
      'gen_ai.tool.call.arguments': expect.stringContaining('"q":"x"'),
    });
  });
});

describe('enrichLLMSpan', () => {
  const enrich = (runtimeContext: Record<string, unknown> | undefined) =>
    enrichLLMSpan({
      spanType: 'languageModel',
      operationId: 'ai.generateText',
      callId: 'call-1',
      runtimeContext,
    });

  it('skips missing, empty and non-string values', () => {
    expect(enrich({ sessionId: '', teamId: 42, userId: undefined })).toEqual(
      {},
    );
    expect(enrich(undefined)).toEqual({});
  });

  it('ignores unrelated runtime context keys', () => {
    expect(enrich({ sessionId: 's1', other: 'x' })).toEqual({
      'gen_ai.conversation.id': 's1',
    });
  });
});

describe('registerAITelemetry', () => {
  afterAll(() => trace.disable());

  it('emits each span once through the global tracer provider, even if registered twice', async () => {
    const perCall = operationNames(
      await runTracedCall({ sessionId: 'session-1' }),
    );

    const exporter = new InMemorySpanExporter();
    trace.setGlobalTracerProvider(
      new BasicTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      }),
    );
    registerAITelemetry();
    registerAITelemetry();
    await runToolCall(llmTelemetry({ sessionId: 'session-global' }));

    const spans = exporter.getFinishedSpans();
    expect(perCall.length).toBeGreaterThan(0);
    expect(operationNames(spans)).toEqual(perCall);
    for (const span of spans) {
      expect(span.attributes['gen_ai.conversation.id']).toBe('session-global');
    }
  });
});
