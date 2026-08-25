import {
  CLAUDE_CODE_LLM_REQUEST_FIXTURE,
  CLAUDE_CODE_TOOL_FIXTURE,
  OPENCODE_API_REQUEST_LOG_FIXTURE,
  OPENCODE_LLM_SPAN_FIXTURE,
  VERCEL_AI_STREAMTEXT_FIXTURE,
} from '@/llm/__fixtures__/spans';
import { isLLMSpan } from '@/llm/lib/detect';
import { extractLLMSpanInfo, hasReportedUsage } from '@/llm/lib/extract';
import { extractConversation } from '@/llm/lib/messages';

// Regression tests for real-world opencode telemetry, which emits three
// overlapping dialects (OpenInference whole-string messages, current Vercel
// AI SDK camelCase usage, and flat-key log events).
describe('opencode-shaped telemetry', () => {
  describe('opencode.llm span (OpenInference whole-string messages)', () => {
    it('is detected and extracts model/usage/cost/session', () => {
      expect(isLLMSpan(OPENCODE_LLM_SPAN_FIXTURE)).toBe(true);
      const info = extractLLMSpanInfo(OPENCODE_LLM_SPAN_FIXTURE);
      expect(info).toMatchObject({
        model: 'claude-fable-5',
        provider: 'anthropic',
        operation: 'llm',
        conversationId: 'ses_fcb2d5104ffeQlRo5dkUhIxY7i',
        providedCostUsd: 6.9962825,
        usage: {
          inputTokens: 2,
          outputTokens: 58,
          totalTokens: 559529,
          cachedInputTokens: 0,
          reasoningOutputTokens: 0,
        },
      });
    });

    it('parses whole-string llm.input_messages into chat messages', () => {
      const conversation = extractConversation(OPENCODE_LLM_SPAN_FIXTURE);
      expect(conversation?.dialect).toBe('openinference');
      expect(conversation?.messages).toEqual([
        { role: 'user', content: 'check all tests', source: 'input' },
      ]);
    });
  });

  describe('ai.streamText span (Vercel AI SDK >= 4 camelCase usage)', () => {
    it('extracts camelCase usage, session id, and TTFT', () => {
      const info = extractLLMSpanInfo(VERCEL_AI_STREAMTEXT_FIXTURE);
      expect(info).toMatchObject({
        model: 'claude-fable-5',
        provider: 'anthropic',
        conversationId: 'ses_fcb16cf68ffeJt01lFlHQjri5R',
        usage: {
          inputTokens: 337271,
          outputTokens: 120,
          cachedInputTokens: 335464,
        },
      });
      expect(info?.timeToFirstTokenMs).toBeCloseTo(4294.845, 2);
    });

    it('renders prompt/response messages', () => {
      const conversation = extractConversation(VERCEL_AI_STREAMTEXT_FIXTURE);
      expect(conversation?.dialect).toBe('vercel-ai');
      expect(conversation?.messages).toEqual([
        { role: 'user', content: 'check all tests', source: 'input' },
        {
          role: 'assistant',
          content: 'Running the tests now.',
          source: 'output',
        },
      ]);
    });
  });

  describe('api_request log event (flat keys)', () => {
    it('is detected via gen_ai.provider.name and extracts flat usage/cost', () => {
      expect(isLLMSpan(OPENCODE_API_REQUEST_LOG_FIXTURE)).toBe(true);
      const info = extractLLMSpanInfo(OPENCODE_API_REQUEST_LOG_FIXTURE);
      expect(info).toMatchObject({
        model: 'claude-fable-5',
        provider: 'anthropic',
        conversationId: 'ses_fcb2d5104ffeQlRo5dkUhIxY7i',
        providedCostUsd: 6.9962825,
        usage: {
          inputTokens: 2,
          outputTokens: 58,
          totalTokens: 60,
          cachedInputTokens: 0,
          reasoningOutputTokens: 0,
        },
      });
    });

    it('does not detect tool_result logs without LLM markers', () => {
      expect(
        isLLMSpan({
          agent: 'build',
          'event.name': 'tool_result',
          'session.id': 'ses_x',
          tool_name: 'bash',
        }),
      ).toBe(false);
    });
  });
});

describe('claude-code-shaped telemetry', () => {
  it('extracts llm_request spans: flat usage, TTFT, bracket model variant', () => {
    expect(isLLMSpan(CLAUDE_CODE_LLM_REQUEST_FIXTURE)).toBe(true);
    const info = extractLLMSpanInfo(CLAUDE_CODE_LLM_REQUEST_FIXTURE);
    expect(info).toMatchObject({
      model: 'claude-opus-5[1m]',
      provider: 'anthropic',
      conversationId: '26e92ce9-12bf-4a0a-9268-9c4e316c939c',
      finishReasons: '["end_turn"]',
      usage: {
        inputTokens: 528,
        outputTokens: 17,
        totalTokens: 545,
        cachedInputTokens: 0,
      },
    });
    expect(info?.timeToFirstTokenMs).toBe(743);
  });

  it('detects tool spans that only carry gen_ai.tool.call.id', () => {
    expect(isLLMSpan(CLAUDE_CODE_TOOL_FIXTURE)).toBe(true);
    const info = extractLLMSpanInfo(CLAUDE_CODE_TOOL_FIXTURE);
    expect(info?.toolName).toBe('Bash');
  });
});

describe('hasReportedUsage', () => {
  it('accepts standard and flat usage reporters', () => {
    expect(hasReportedUsage(CLAUDE_CODE_LLM_REQUEST_FIXTURE)).toBe(true);
    expect(hasReportedUsage(OPENCODE_LLM_SPAN_FIXTURE)).toBe(true);
    expect(hasReportedUsage(OPENCODE_API_REQUEST_LOG_FIXTURE)).toBe(true);
  });

  it('rejects wrapper spans that only carry ai.usage.* and non-reporters', () => {
    expect(
      hasReportedUsage({
        'ai.operationId': 'ai.streamText',
        'ai.usage.inputTokens': '100',
        'ai.usage.outputTokens': '10',
      }),
    ).toBe(false);
    expect(hasReportedUsage(CLAUDE_CODE_TOOL_FIXTURE)).toBe(false);
    expect(hasReportedUsage(undefined)).toBe(false);
  });
});
