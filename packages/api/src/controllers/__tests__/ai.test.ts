import type { LanguageModel } from 'ai';

const mockAnthropicModel = {
  modelId: 'claude-sonnet-4-5-20250929',
} as unknown as LanguageModel;

const mockOpenAIModel = {
  modelId: 'gpt-4o',
} as unknown as LanguageModel;

const mockAnthropicFactory = jest.fn((_model?: string) => mockAnthropicModel);
const mockCreateAnthropic = jest.fn(
  (_opts?: Record<string, unknown>) => mockAnthropicFactory,
);

const mockOpenAIResponsesFactory = jest.fn(
  (_model?: string) => mockOpenAIModel,
);
const mockCreateOpenAI = jest.fn((_opts?: Record<string, unknown>) => ({
  responses: mockOpenAIResponsesFactory,
}));

jest.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: (opts: Record<string, unknown>) => mockCreateAnthropic(opts),
}));

jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: (opts: Record<string, unknown>) => mockCreateOpenAI(opts),
}));

jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockConfig: Record<string, unknown> = { __esModule: true };

jest.mock('@/config', () => mockConfig);

function setConfig(overrides: Record<string, string | undefined>) {
  Object.keys(mockConfig).forEach(k => {
    if (k !== '__esModule') delete mockConfig[k];
  });
  Object.assign(mockConfig, overrides);
}

import { DisplayType, SourceKind } from '@hyperdx/common-utils/dist/types';

import { getAIModel, getChartConfigFromResolvedConfig } from '@/controllers/ai';
import type { ISource } from '@/models/source';

beforeEach(() => {
  setConfig({});
  jest.clearAllMocks();
});

describe('getAIModel', () => {
  describe('provider routing', () => {
    it('throws when no provider is configured', () => {
      expect(() => getAIModel()).toThrow(
        'No AI provider configured. Set AI_PROVIDER and AI_API_KEY environment variables.',
      );
    });

    it('throws on unknown provider', () => {
      setConfig({ AI_PROVIDER: 'gemini' });
      expect(() => getAIModel()).toThrow(
        'Unknown AI provider: gemini. Currently supported: anthropic, openai',
      );
    });

    it('routes to anthropic when AI_PROVIDER=anthropic', () => {
      setConfig({
        AI_PROVIDER: 'anthropic',
        AI_API_KEY: 'sk-test',
      });
      const model = getAIModel();
      expect(model).toBe(mockAnthropicModel);
      expect(mockCreateAnthropic).toHaveBeenCalledTimes(1);
    });

    it('routes to openai when AI_PROVIDER=openai', () => {
      setConfig({
        AI_PROVIDER: 'openai',
        AI_API_KEY: 'sk-test',
        AI_MODEL_NAME: 'gpt-4o',
      });
      const model = getAIModel();
      expect(model).toBe(mockOpenAIModel);
      expect(mockCreateOpenAI).toHaveBeenCalledTimes(1);
    });
  });

  describe('legacy anthropic support', () => {
    it('falls back to anthropic when ANTHROPIC_API_KEY is set without AI_PROVIDER', () => {
      setConfig({
        ANTHROPIC_API_KEY: 'sk-ant-legacy',
      });
      const model = getAIModel();
      expect(model).toBe(mockAnthropicModel);
      expect(mockCreateAnthropic).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'sk-ant-legacy' }),
      );
    });
  });
});

describe('anthropic provider', () => {
  it('throws when no API key is set', () => {
    setConfig({ AI_PROVIDER: 'anthropic' });
    expect(() => getAIModel()).toThrow(
      'No API key defined for Anthropic. Set AI_API_KEY or ANTHROPIC_API_KEY.',
    );
  });

  it('uses AI_API_KEY over ANTHROPIC_API_KEY', () => {
    setConfig({
      AI_PROVIDER: 'anthropic',
      AI_API_KEY: 'sk-new',
      ANTHROPIC_API_KEY: 'sk-old',
    });
    getAIModel();
    expect(mockCreateAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-new' }),
    );
  });

  it('passes baseURL when AI_BASE_URL is set', () => {
    setConfig({
      AI_PROVIDER: 'anthropic',
      AI_API_KEY: 'sk-test',
      AI_BASE_URL: 'https://custom.endpoint.com',
    });
    getAIModel();
    expect(mockCreateAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-test',
        baseURL: 'https://custom.endpoint.com',
      }),
    );
  });

  it('uses default model when AI_MODEL_NAME is not set', () => {
    setConfig({
      AI_PROVIDER: 'anthropic',
      AI_API_KEY: 'sk-test',
    });
    getAIModel();
    expect(mockAnthropicFactory).toHaveBeenCalledWith(
      'claude-sonnet-4-5-20250929',
    );
  });

  it('uses custom model name when AI_MODEL_NAME is set', () => {
    setConfig({
      AI_PROVIDER: 'anthropic',
      AI_API_KEY: 'sk-test',
      AI_MODEL_NAME: 'claude-3-haiku-20240307',
    });
    getAIModel();
    expect(mockAnthropicFactory).toHaveBeenCalledWith(
      'claude-3-haiku-20240307',
    );
  });
});

describe('openai provider', () => {
  it('throws when no API key is set', () => {
    setConfig({ AI_PROVIDER: 'openai' });
    expect(() => getAIModel()).toThrow(
      'No API key defined for OpenAI provider. Set AI_API_KEY.',
    );
  });

  it('throws when no model name is set', () => {
    setConfig({
      AI_PROVIDER: 'openai',
      AI_API_KEY: 'sk-test',
    });
    expect(() => getAIModel()).toThrow(
      'No model name configured for OpenAI provider. Set AI_MODEL_NAME',
    );
  });

  it('creates provider with minimal config', () => {
    setConfig({
      AI_PROVIDER: 'openai',
      AI_API_KEY: 'sk-test',
      AI_MODEL_NAME: 'gpt-4o',
    });
    getAIModel();
    expect(mockCreateOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-test' }),
    );
    expect(mockOpenAIResponsesFactory).toHaveBeenCalledWith('gpt-4o');
  });

  it('passes baseURL when AI_BASE_URL is set', () => {
    setConfig({
      AI_PROVIDER: 'openai',
      AI_API_KEY: 'sk-test',
      AI_MODEL_NAME: 'gpt-4o',
      AI_BASE_URL: 'https://proxy.example.com/v1',
    });
    getAIModel();
    expect(mockCreateOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-test',
        baseURL: 'https://proxy.example.com/v1',
      }),
    );
  });

  describe('AI_REQUEST_HEADERS', () => {
    it('passes parsed headers to createOpenAI', () => {
      setConfig({
        AI_PROVIDER: 'openai',
        AI_API_KEY: 'sk-test',
        AI_MODEL_NAME: 'gpt-4o',
        AI_REQUEST_HEADERS: '{"X-Custom":"val1","X-Other":"val2"}',
      });
      getAIModel();
      expect(mockCreateOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: { 'X-Custom': 'val1', 'X-Other': 'val2' },
        }),
      );
    });

    it('throws when AI_REQUEST_HEADERS is invalid JSON', () => {
      setConfig({
        AI_PROVIDER: 'openai',
        AI_API_KEY: 'sk-test',
        AI_MODEL_NAME: 'gpt-4o',
        AI_REQUEST_HEADERS: '{bad',
      });
      expect(() => getAIModel()).toThrow(
        'AI_REQUEST_HEADERS is not valid JSON',
      );
    });

    it('omits headers when AI_REQUEST_HEADERS is not set', () => {
      setConfig({
        AI_PROVIDER: 'openai',
        AI_API_KEY: 'sk-test',
        AI_MODEL_NAME: 'gpt-4o',
      });
      getAIModel();
      const call = mockCreateOpenAI.mock.calls[0]?.[0];
      expect(call?.headers).toBeUndefined();
    });
  });
});

describe('getChartConfigFromResolvedConfig', () => {
  // @ts-expect-error mock source only has the fields getChartConfigFromResolvedConfig reads
  const source: ISource = {
    id: 'source-id',
    kind: SourceKind.Trace,
    connection: 'connection-id',
    from: { databaseName: 'default', tableName: 'otel_traces' },
    timestampValueExpression: 'Timestamp',
  };

  it('maps percentile aggregations to quantile with a level', () => {
    const result = getChartConfigFromResolvedConfig(
      {
        displayType: DisplayType.Table,
        select: [
          { aggregationFunction: 'max', property: 'Duration' },
          {
            aggregationFunction: 'p95',
            property: 'Duration',
            condition: "ServiceName = 'api'",
          },
        ],
        groupBy: 'SpanName',
        timeRange: 'Past 1h',
      },
      source,
    );

    expect(result.select).toEqual([
      { aggFn: 'max', valueExpression: 'Duration' },
      {
        aggFn: 'quantile',
        level: 0.95,
        valueExpression: 'Duration',
        aggCondition: "ServiceName = 'api'",
        aggConditionLanguage: 'sql',
      },
    ]);
  });
});
