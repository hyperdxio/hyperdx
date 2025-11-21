import { TSource } from '@hyperdx/common-utils/dist/types';

// Helper function to format field access based on column type
function formatFieldAccess(
  field: string,
  key: string,
  isJsonColumn: boolean,
): string {
  return isJsonColumn ? `${field}.\`${key}\`` : `${field}['${key}']`;
}

// Model pricing in USD per 1M tokens (input/output)
// Based on common LLM provider pricing as of 2024
export const MODEL_PRICING: Record<
  string,
  { input: number; output: number; provider: string }
> = {
  // OpenAI GPT-4o
  'gpt-4o': { input: 2.5, output: 10, provider: 'openai' },
  'gpt-4o-mini': { input: 0.15, output: 0.6, provider: 'openai' },
  'gpt-4-turbo': { input: 10, output: 30, provider: 'openai' },
  'gpt-4': { input: 30, output: 60, provider: 'openai' },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5, provider: 'openai' },

  // Anthropic Claude
  'claude-3-opus-20240229': { input: 15, output: 75, provider: 'anthropic' },
  'claude-3-sonnet-20240229': { input: 3, output: 15, provider: 'anthropic' },
  'claude-3-haiku-20240307': {
    input: 0.25,
    output: 1.25,
    provider: 'anthropic',
  },
  'claude-3-5-sonnet-20241022': { input: 3, output: 15, provider: 'anthropic' },
  'claude-sonnet-4-5-20250929': { input: 3, output: 15, provider: 'anthropic' },

  // Default fallback
  default: { input: 1, output: 2, provider: 'unknown' },
};

function getDefaults({
  spanAttributeField = 'SpanAttributes',
  isAttributeFieldJSON = false,
}: {
  spanAttributeField?: string;
  isAttributeFieldJSON?: boolean;
} = {}) {
  return {
    // GenAI semantic conventions
    genAiSystem: formatFieldAccess(
      spanAttributeField,
      'gen_ai.system',
      isAttributeFieldJSON,
    ),
    genAiModel: formatFieldAccess(
      spanAttributeField,
      'gen_ai.request.model',
      isAttributeFieldJSON,
    ),
    genAiOperationName: formatFieldAccess(
      spanAttributeField,
      'gen_ai.operation.name',
      isAttributeFieldJSON,
    ),
    genAiFinishReason: formatFieldAccess(
      spanAttributeField,
      'gen_ai.response.finish_reasons',
      isAttributeFieldJSON,
    ),
    genAiInputTokens: formatFieldAccess(
      spanAttributeField,
      'gen_ai.usage.input_tokens',
      isAttributeFieldJSON,
    ),
    genAiOutputTokens: formatFieldAccess(
      spanAttributeField,
      'gen_ai.usage.output_tokens',
      isAttributeFieldJSON,
    ),

    // User identification
    userId: formatFieldAccess(
      spanAttributeField,
      'user.id',
      isAttributeFieldJSON,
    ),

    // Request metadata
    requestId: formatFieldAccess(
      spanAttributeField,
      'request.id',
      isAttributeFieldJSON,
    ),

    // Trace fields
    duration: 'Duration',
    durationPrecision: 9,
    service: 'ServiceName',
    spanName: 'SpanName',
    severityText: 'StatusCode',
  };
}

export function getExpressions(source?: TSource, jsonColumns: string[] = []) {
  const spanAttributeField =
    source?.eventAttributesExpression || 'SpanAttributes';
  const isAttributeFieldJSON = jsonColumns.includes(spanAttributeField);
  const defaults = getDefaults({ spanAttributeField, isAttributeFieldJSON });

  const fieldExpressions = {
    // General trace fields
    duration: source?.durationExpression || defaults.duration,
    durationPrecision: source?.durationPrecision || defaults.durationPrecision,
    service: source?.serviceNameExpression || defaults.service,
    spanName: source?.spanNameExpression || defaults.spanName,
    severityText: source?.severityTextExpression || defaults.severityText,

    // GenAI specific fields
    genAiSystem: defaults.genAiSystem,
    genAiModel: defaults.genAiModel,
    genAiOperationName: defaults.genAiOperationName,
    genAiFinishReason: defaults.genAiFinishReason,
    genAiInputTokens: defaults.genAiInputTokens,
    genAiOutputTokens: defaults.genAiOutputTokens,

    // User fields
    userId: defaults.userId,
    requestId: defaults.requestId,
  };

  const calculatedExpressions = {
    // Duration in milliseconds
    durationInMillis: `${fieldExpressions.duration}/1e${fieldExpressions.durationPrecision - 3}`,

    // Total tokens
    totalTokens: `toFloat64OrNull(${fieldExpressions.genAiInputTokens}) + toFloat64OrNull(${fieldExpressions.genAiOutputTokens})`,

    // Cost calculation (simplified - uses average pricing)
    // For accurate cost, we'd need CASE statements per model
    estimatedCost: `(toFloat64OrNull(${fieldExpressions.genAiInputTokens}) * 0.001 + toFloat64OrNull(${fieldExpressions.genAiOutputTokens}) * 0.003) / 1000`,
  };

  const filterExpressions = {
    // Check if span is an LLM call (has gen_ai.system attribute)
    isLLMSpan: `${fieldExpressions.genAiSystem} != ''`,

    // Check if request was successful
    isSuccess: `lower(${fieldExpressions.severityText}) != 'error'`,

    // Check if request had errors
    isError: `lower(${fieldExpressions.severityText}) = 'error'`,
  };

  return {
    ...fieldExpressions,
    ...calculatedExpressions,
    ...filterExpressions,
  };
}

// Build a more accurate cost calculation expression with model-specific pricing
export function buildCostExpression(
  inputTokensExpr: string,
  outputTokensExpr: string,
  modelExpr: string,
): string {
  const cases: string[] = [];

  // Build CASE statement for each model
  for (const [modelName, pricing] of Object.entries(MODEL_PRICING)) {
    if (modelName === 'default') continue;

    cases.push(
      `WHEN ${modelExpr} = '${modelName}' THEN (toFloat64OrNull(${inputTokensExpr}) * ${pricing.input} + toFloat64OrNull(${outputTokensExpr}) * ${pricing.output}) / 1000000`,
    );
  }

  // Default case
  const defaultPricing = MODEL_PRICING.default;
  cases.push(
    `ELSE (toFloat64OrNull(${inputTokensExpr}) * ${defaultPricing.input} + toFloat64OrNull(${outputTokensExpr}) * ${defaultPricing.output}) / 1000000`,
  );

  return `CASE ${cases.join(' ')} END`;
}
