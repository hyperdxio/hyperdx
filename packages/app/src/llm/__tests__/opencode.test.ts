import {
  CLAUDE_CODE_LLM_REQUEST_FIXTURE,
  CLAUDE_CODE_TOOL_FIXTURE,
  OPENCODE_API_REQUEST_LOG_FIXTURE,
  OPENCODE_LLM_SPAN_FIXTURE,
  VERCEL_AI_DOSTREAM_FIXTURE,
  VERCEL_AI_STREAMTEXT_FIXTURE,
} from '@/llm/__fixtures__/spans';
import { computeCostUsd } from '@/llm/lib/cost';
import { isLLMSpan } from '@/llm/lib/detect';
import { extractLLMSpanInfo, hasReportedUsage } from '@/llm/lib/extract';
import { extractConversation } from '@/llm/lib/messages';

/** Expected messages carry sequential ids, mirroring extractConversation. */
const withIds = <T>(messages: T[]) => messages.map((m, id) => ({ ...m, id }));

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
          cacheWriteInputTokens: 559469,
          reasoningOutputTokens: 0,
        },
      });
    });

    it('catalog estimate reproduces the provided cost exactly', () => {
      // Exclusive-style: llm.token_count.prompt excludes the cache write.
      const info = extractLLMSpanInfo(OPENCODE_LLM_SPAN_FIXTURE);
      expect(computeCostUsd(info!.usage, info!.model)).toBeCloseTo(
        info!.providedCostUsd!,
        7,
      );
    });

    it('parses whole-string llm.input_messages into chat messages', () => {
      const conversation = extractConversation(OPENCODE_LLM_SPAN_FIXTURE);
      expect(conversation?.dialect).toBe('openinference');
      expect(conversation?.messages).toEqual(
        withIds([
          { role: 'user', content: 'check all tests', source: 'input' },
        ]),
      );
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
      expect(conversation?.messages).toEqual(
        withIds([
          { role: 'user', content: 'check all tests', source: 'input' },
          {
            role: 'assistant',
            content: 'Running the tests now.',
            source: 'output',
          },
        ]),
      );
    });
  });

  describe('ai.streamText.doStream span (dual-dialect duplicate)', () => {
    it('extracts inclusive-style usage with cache read/write splits', () => {
      const info = extractLLMSpanInfo(VERCEL_AI_DOSTREAM_FIXTURE);
      expect(info?.usage).toMatchObject({
        inputTokens: 650_361,
        outputTokens: 369,
        cachedInputTokens: 649_452,
        cacheWriteInputTokens: 907,
      });
    });

    it('catalog estimate matches the opencode-reported cost for the call', () => {
      // Inclusive-style: uncached (2) at $10/M + reads (649,452) at $1/M +
      // writes (907) at $12.5/M + output (369) at $50/M.
      const info = extractLLMSpanInfo(VERCEL_AI_DOSTREAM_FIXTURE);
      expect(computeCostUsd(info!.usage, info!.model)).toBeCloseTo(
        0.6792595,
        7,
      );
    });

    it('passes the reported-usage gate like the opencode.llm span does', () => {
      // Both dialects report usage for the same physical call (in different
      // traces), so no row-local gate can dedupe them — that is what the
      // provided-cost election in llmGatedSumExpr is for.
      expect(hasReportedUsage(OPENCODE_LLM_SPAN_FIXTURE)).toBe(true);
      expect(hasReportedUsage(VERCEL_AI_DOSTREAM_FIXTURE)).toBe(true);
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
          // Full context processed: flat input_tokens excludes the 559,469
          // cache-write tokens, so the derived total folds them back in.
          totalTokens: 559_529,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 559_469,
          reasoningOutputTokens: 0,
        },
      });
    });

    it('catalog estimate reproduces the provided cost exactly', () => {
      // cache writes at $12.5/M + input at $10/M + output at $50/M.
      const info = extractLLMSpanInfo(OPENCODE_API_REQUEST_LOG_FIXTURE);
      expect(computeCostUsd(info!.usage, info!.model)).toBeCloseTo(
        info!.providedCostUsd!,
        7,
      );
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
