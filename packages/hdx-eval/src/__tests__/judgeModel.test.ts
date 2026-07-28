import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

import {
  DEFAULT_JUDGE_MODEL,
  DEFAULT_JUDGE_PROVIDER,
  DEFAULT_JUDGE_SPEC,
  judgeCredentialsAvailable,
  parseJudgeSpec,
  resolveJudgeModel,
} from '@/grading/judgeModel';

// Spy on the provider factories to capture the apiKey each judge is built with.
// This lets us assert key-precedence without exposing secrets on the model.
jest.mock('@ai-sdk/anthropic', () => {
  const actual = jest.requireActual('@ai-sdk/anthropic');
  return { ...actual, createAnthropic: jest.fn(actual.createAnthropic) };
});
jest.mock('@ai-sdk/openai', () => {
  const actual = jest.requireActual('@ai-sdk/openai');
  return { ...actual, createOpenAI: jest.fn(actual.createOpenAI) };
});

const mockCreateAnthropic = createAnthropic as jest.MockedFunction<
  typeof createAnthropic
>;
const mockCreateOpenAI = createOpenAI as jest.MockedFunction<
  typeof createOpenAI
>;

function anthropicApiKeyArg(): string | undefined {
  return mockCreateAnthropic.mock.calls.at(-1)?.[0]?.apiKey;
}
function openaiApiKeyArg(): string | undefined {
  return mockCreateOpenAI.mock.calls.at(-1)?.[0]?.apiKey;
}

// `LanguageModel` is a union of `string | LanguageModelV2`; resolveJudgeModel
// always returns the object form, so narrow it to read provider/modelId.
function meta(model: LanguageModel): { provider: string; modelId: string } {
  return model as { provider: string; modelId: string };
}

// resolveJudgeModel reads provider credentials from process.env. Snapshot and
// restore the relevant keys around each test so cases don't leak into each
// other (or into the real shell env when run locally).
const ENV_KEYS = [
  'AI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'AI_BASE_URL',
  'AI_REQUEST_HEADERS',
] as const;

describe('parseJudgeSpec', () => {
  it('defaults a bare model name to the anthropic provider', () => {
    const parsed = parseJudgeSpec('claude-opus-4-7');
    expect(parsed.provider).toBe('anthropic');
    expect(parsed.model).toBe('claude-opus-4-7');
    expect(parsed.spec).toBe('anthropic:claude-opus-4-7');
  });

  it('parses an explicit provider:model spec', () => {
    const parsed = parseJudgeSpec('openai:gpt-4o');
    expect(parsed.provider).toBe('openai');
    expect(parsed.model).toBe('gpt-4o');
    expect(parsed.spec).toBe('openai:gpt-4o');
  });

  it('is case-insensitive on the provider and trims whitespace', () => {
    const parsed = parseJudgeSpec('  OpenAI : gpt-4o  ');
    expect(parsed.provider).toBe('openai');
    expect(parsed.model).toBe('gpt-4o');
  });

  it('only splits on the first colon so model names may contain colons', () => {
    const parsed = parseJudgeSpec('openai:ft:gpt-4o:custom');
    expect(parsed.provider).toBe('openai');
    expect(parsed.model).toBe('ft:gpt-4o:custom');
  });

  it('throws on an unknown provider', () => {
    expect(() => parseJudgeSpec('gemini:pro')).toThrow(
      /Unknown judge provider/,
    );
  });

  it('throws on an empty spec', () => {
    expect(() => parseJudgeSpec('   ')).toThrow(/empty/);
  });

  it('throws when the model name is missing after the provider', () => {
    expect(() => parseJudgeSpec('openai:')).toThrow(/missing a model name/);
  });

  it('exposes a fully-qualified default spec', () => {
    expect(DEFAULT_JUDGE_SPEC).toBe(
      `${DEFAULT_JUDGE_PROVIDER}:${DEFAULT_JUDGE_MODEL}`,
    );
    expect(parseJudgeSpec(DEFAULT_JUDGE_SPEC).spec).toBe(DEFAULT_JUDGE_SPEC);
  });
});

describe('resolveJudgeModel', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('resolves an anthropic model from ANTHROPIC_API_KEY', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const model = resolveJudgeModel('anthropic:claude-opus-4-7');
    expect(meta(model).provider).toMatch(/anthropic/);
    expect(meta(model).modelId).toBe('claude-opus-4-7');
  });

  it('resolves an anthropic model from AI_API_KEY too', () => {
    process.env.AI_API_KEY = 'sk-ai-test';
    const model = resolveJudgeModel('claude-opus-4-7');
    expect(meta(model).provider).toMatch(/anthropic/);
    expect(meta(model).modelId).toBe('claude-opus-4-7');
  });

  it('resolves an openai model from OPENAI_API_KEY', () => {
    process.env.OPENAI_API_KEY = 'sk-oai-test';
    const model = resolveJudgeModel('openai:gpt-4o');
    expect(meta(model).provider).toMatch(/openai/);
    expect(meta(model).modelId).toBe('gpt-4o');
  });

  it('resolves an openai model from AI_API_KEY too', () => {
    process.env.AI_API_KEY = 'sk-ai-test';
    const model = resolveJudgeModel('openai:gpt-4o');
    expect(meta(model).provider).toMatch(/openai/);
    expect(meta(model).modelId).toBe('gpt-4o');
  });

  it('throws a clear error when the anthropic key is missing', () => {
    expect(() => resolveJudgeModel('anthropic:claude-opus-4-7')).toThrow(
      /No API key defined for the Anthropic judge/,
    );
  });

  it('throws a clear error when the openai key is missing', () => {
    expect(() => resolveJudgeModel('openai:gpt-4o')).toThrow(
      /No API key defined for the OpenAI judge/,
    );
  });

  it('honors AI_BASE_URL for anthropic', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.AI_BASE_URL = 'https://proxy.example.com';
    // Should build without throwing; the base URL is wired into the client.
    const model = resolveJudgeModel('anthropic:claude-opus-4-7');
    expect(meta(model).modelId).toBe('claude-opus-4-7');
  });

  it('honors AI_REQUEST_HEADERS for openai', () => {
    process.env.OPENAI_API_KEY = 'sk-oai-test';
    process.env.AI_REQUEST_HEADERS = JSON.stringify({ 'x-custom': 'yes' });
    const model = resolveJudgeModel('openai:gpt-4o');
    expect(meta(model).modelId).toBe('gpt-4o');
  });

  it('throws on malformed AI_REQUEST_HEADERS', () => {
    process.env.OPENAI_API_KEY = 'sk-oai-test';
    process.env.AI_REQUEST_HEADERS = 'not-json';
    expect(() => resolveJudgeModel('openai:gpt-4o')).toThrow(
      /AI_REQUEST_HEADERS is not valid JSON/,
    );
  });
});

describe('resolveJudgeModel key precedence', () => {
  // The eval runner is always Anthropic and typically sets AI_API_KEY, while
  // the judge may be OpenAI. The provider-specific key must win so AI_API_KEY
  // (the runner's Anthropic key) is never sent to OpenAI.
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    mockCreateAnthropic.mockClear();
    mockCreateOpenAI.mockClear();
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('the OpenAI judge prefers OPENAI_API_KEY over AI_API_KEY', () => {
    // Simulates the real eval setup: AI_API_KEY holds the Anthropic runner key.
    process.env.AI_API_KEY = 'sk-ant-runner';
    process.env.OPENAI_API_KEY = 'sk-openai-grader';
    resolveJudgeModel('openai:gpt-4o');
    expect(openaiApiKeyArg()).toBe('sk-openai-grader');
  });

  it('the OpenAI judge falls back to AI_API_KEY when OPENAI_API_KEY is absent', () => {
    process.env.AI_API_KEY = 'sk-shared';
    resolveJudgeModel('openai:gpt-4o');
    expect(openaiApiKeyArg()).toBe('sk-shared');
  });

  it('the Anthropic judge prefers ANTHROPIC_API_KEY over AI_API_KEY', () => {
    process.env.AI_API_KEY = 'sk-shared';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-grader';
    resolveJudgeModel('anthropic:claude-opus-4-7');
    expect(anthropicApiKeyArg()).toBe('sk-ant-grader');
  });

  it('the Anthropic judge falls back to AI_API_KEY when ANTHROPIC_API_KEY is absent', () => {
    process.env.AI_API_KEY = 'sk-shared';
    resolveJudgeModel('anthropic:claude-opus-4-7');
    expect(anthropicApiKeyArg()).toBe('sk-shared');
  });
});

describe('judgeCredentialsAvailable', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('is false when no key is present', () => {
    expect(judgeCredentialsAvailable('anthropic:claude-opus-4-7')).toBe(false);
    expect(judgeCredentialsAvailable('openai:gpt-4o')).toBe(false);
  });

  it('is true for anthropic when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'x';
    expect(judgeCredentialsAvailable('anthropic:claude-opus-4-7')).toBe(true);
    // The openai provider still needs its own (or AI_API_KEY) key.
    expect(judgeCredentialsAvailable('openai:gpt-4o')).toBe(false);
  });

  it('is true for openai when OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'x';
    expect(judgeCredentialsAvailable('openai:gpt-4o')).toBe(true);
    expect(judgeCredentialsAvailable('anthropic:claude-opus-4-7')).toBe(false);
  });

  it('AI_API_KEY satisfies either provider', () => {
    process.env.AI_API_KEY = 'x';
    expect(judgeCredentialsAvailable('anthropic:claude-opus-4-7')).toBe(true);
    expect(judgeCredentialsAvailable('openai:gpt-4o')).toBe(true);
  });
});
