import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';

import * as config from '@/config';
import logger from '@/utils/logger';

type AIProvider = 'anthropic' | 'openai';

/**
 * Get configured AI model for use in the application.
 * Currently supports Anthropic (with both direct API and Azure AI endpoints).
 * Architecture supports multiple providers for future extensibility.
 *
 * Configuration is determined by environment variables:
 * - AI_PROVIDER: Provider to use (currently only 'anthropic' is supported)
 * - AI_API_KEY: API key for the provider
 * - AI_BASE_URL: (Optional) Custom endpoint URL (for Azure AI Anthropic)
 * - AI_MODEL_NAME: (Optional) Model or deployment name
 *
 * For backward compatibility, also supports legacy ANTHROPIC_API_KEY env var.
 *
 * @returns LanguageModel instance ready to use
 * @throws Error if required configuration is missing or provider is unsupported
 */
export function getAIModel(): LanguageModel {
  // Determine provider with backward compatibility
  let provider: AIProvider | undefined = config.AI_PROVIDER as AIProvider;

  // Legacy support: if no AI_PROVIDER but ANTHROPIC_API_KEY exists, use anthropic
  if (!provider && config.ANTHROPIC_API_KEY) {
    provider = 'anthropic';
    logger.warn(
      'Using legacy ANTHROPIC_API_KEY. Consider migrating to AI_PROVIDER and AI_API_KEY.',
    );
  }

  if (!provider) {
    throw new Error(
      'No AI provider configured. Set AI_PROVIDER and AI_API_KEY environment variables.',
    );
  }

  logger.info({ provider }, 'Initializing AI provider');

  switch (provider) {
    case 'anthropic':
      return getAnthropicModel();

    case 'openai':
      throw new Error(
        `Provider '${provider}' is not yet supported. Currently only 'anthropic' is available. ` +
        'Support for additional providers can be added in the future.',
      );

    default:
      throw new Error(
        `Unknown AI provider: ${provider}. Currently supported: anthropic`,
      );
  }
}

/**
 * Configure Anthropic model.
 * Supports both direct Anthropic API and Azure AI Anthropic endpoints.
 */
function getAnthropicModel(): LanguageModel {
  // Support both new AI_API_KEY and legacy ANTHROPIC_API_KEY
  const apiKey = config.AI_API_KEY || config.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error(
      'No API key defined for Anthropic. Set AI_API_KEY or ANTHROPIC_API_KEY.',
    );
  }

  type AnthropicConfig = NonNullable<Parameters<typeof createAnthropic>[0]>;

  const anthropicConfig: AnthropicConfig = {
    apiKey,
  };

  // Support other AI Anthropic endpoints or custom base URLs
  if (config.AI_BASE_URL) {
    anthropicConfig.baseURL = config.AI_BASE_URL;
  }

  const anthropic = createAnthropic(anthropicConfig);

  // Use custom model name if configured, otherwise use default
  const modelName = config.AI_MODEL_NAME || 'claude-sonnet-4-5-20250929';

  return anthropic(modelName);
}