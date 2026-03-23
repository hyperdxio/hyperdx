import type { LanguageModel } from 'ai';

const mockAnthropicModel = {
  modelId: 'claude-sonnet-4-5-20250929',
} as unknown as LanguageModel;

const mockOpenAIModel = {
  modelId: 'gpt-4o',
} as unknown as LanguageModel;

const mockAnthropicFactory = jest.fn(() => mockAnthropicModel);
const mockCreateAnthropic = jest.fn(() => mockAnthropicFactory);

const mockOpenAIChatFactory = jest.fn(() => mockOpenAIModel);
const mockCreateOpenAI = jest.fn(() => ({
  chat: mockOpenAIChatFactory,
}));

jest.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: (...args: unknown[]) => mockCreateAnthropic(...args),
}));

jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: (...args: unknown[]) => mockCreateOpenAI(...args),
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

import { getAIModel } from '@/controllers/ai';

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
    expect(mockOpenAIChatFactory).toHaveBeenCalledWith('gpt-4o');
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

  describe('custom headers', () => {
    it('adds X-Client-Id header when AI_CLIENT_ID is set', () => {
      setConfig({
        AI_PROVIDER: 'openai',
        AI_API_KEY: 'sk-test',
        AI_MODEL_NAME: 'gpt-4o',
        AI_CLIENT_ID: 'MyApp',
      });
      getAIModel();
      expect(mockCreateOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Client-Id': 'MyApp',
          }),
        }),
      );
    });

    it('adds X-Username header when AI_USERNAME is set', () => {
      setConfig({
        AI_PROVIDER: 'openai',
        AI_API_KEY: 'sk-test',
        AI_MODEL_NAME: 'gpt-4o',
        AI_USERNAME: 'testuser',
      });
      getAIModel();
      expect(mockCreateOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Username': 'testuser',
          }),
        }),
      );
    });

    it('adds both headers when both are set', () => {
      setConfig({
        AI_PROVIDER: 'openai',
        AI_API_KEY: 'sk-test',
        AI_MODEL_NAME: 'gpt-4o',
        AI_CLIENT_ID: 'MyApp',
        AI_USERNAME: 'testuser',
      });
      getAIModel();
      expect(mockCreateOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: {
            'X-Client-Id': 'MyApp',
            'X-Username': 'testuser',
          },
        }),
      );
    });

    it('omits headers object when neither is set', () => {
      setConfig({
        AI_PROVIDER: 'openai',
        AI_API_KEY: 'sk-test',
        AI_MODEL_NAME: 'gpt-4o',
      });
      getAIModel();
      const call = mockCreateOpenAI.mock.calls[0][0];
      expect(call.headers).toBeUndefined();
    });
  });

  describe('AI_EXTRA_BODY', () => {
    it('throws when AI_EXTRA_BODY is not valid JSON', () => {
      setConfig({
        AI_PROVIDER: 'openai',
        AI_API_KEY: 'sk-test',
        AI_MODEL_NAME: 'gpt-4o',
        AI_EXTRA_BODY: '{bad json',
      });
      expect(() => getAIModel()).toThrow('AI_EXTRA_BODY is not valid JSON');
    });

    it('provides a custom fetch when AI_EXTRA_BODY is valid JSON', () => {
      setConfig({
        AI_PROVIDER: 'openai',
        AI_API_KEY: 'sk-test',
        AI_MODEL_NAME: 'gpt-4o',
        AI_EXTRA_BODY: '{"extra_key":"extra_val"}',
      });
      getAIModel();
      const call = mockCreateOpenAI.mock.calls[0][0];
      expect(call.fetch).toBeDefined();
      expect(typeof call.fetch).toBe('function');
    });

    it('does not provide custom fetch when AI_EXTRA_BODY is not set', () => {
      setConfig({
        AI_PROVIDER: 'openai',
        AI_API_KEY: 'sk-test',
        AI_MODEL_NAME: 'gpt-4o',
      });
      getAIModel();
      const call = mockCreateOpenAI.mock.calls[0][0];
      expect(call.fetch).toBeUndefined();
    });

    it('custom fetch injects extra fields into JSON request body', async () => {
      const mockFetch = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{}'));

      setConfig({
        AI_PROVIDER: 'openai',
        AI_API_KEY: 'sk-test',
        AI_MODEL_NAME: 'gpt-4o',
        AI_EXTRA_BODY: '{"extra_key":"extra_val","debug":true}',
      });
      getAIModel();
      const customFetch = mockCreateOpenAI.mock.calls[0][0].fetch;

      await customFetch('https://api.example.com/v1/chat', {
        body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
        method: 'POST',
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, init] = mockFetch.mock.calls[0];
      const sentBody = JSON.parse(init!.body as string);
      expect(sentBody).toEqual({
        model: 'gpt-4o',
        messages: [],
        extra_key: 'extra_val',
        debug: true,
      });

      mockFetch.mockRestore();
    });

    it('custom fetch sends unmodified body when body is not JSON', async () => {
      const logger = jest.requireMock('@/utils/logger').default;
      const mockFetch = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{}'));

      setConfig({
        AI_PROVIDER: 'openai',
        AI_API_KEY: 'sk-test',
        AI_MODEL_NAME: 'gpt-4o',
        AI_EXTRA_BODY: '{"extra_key":"extra_val"}',
      });
      getAIModel();
      const customFetch = mockCreateOpenAI.mock.calls[0][0].fetch;

      await customFetch('https://api.example.com/v1/chat', {
        body: 'not-json',
        method: 'POST',
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, init] = mockFetch.mock.calls[0];
      expect(init!.body).toBe('not-json');
      expect(logger.warn).toHaveBeenCalledWith(
        'AI_EXTRA_BODY: request body is not JSON, sending unmodified',
      );

      mockFetch.mockRestore();
    });

    it('custom fetch passes through when body is not a string', async () => {
      const mockFetch = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{}'));

      setConfig({
        AI_PROVIDER: 'openai',
        AI_API_KEY: 'sk-test',
        AI_MODEL_NAME: 'gpt-4o',
        AI_EXTRA_BODY: '{"extra_key":"extra_val"}',
      });
      getAIModel();
      const customFetch = mockCreateOpenAI.mock.calls[0][0].fetch;

      await customFetch('https://api.example.com/v1/chat', {
        method: 'GET',
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, init] = mockFetch.mock.calls[0];
      expect(init!.body).toBeUndefined();

      mockFetch.mockRestore();
    });
  });
});
