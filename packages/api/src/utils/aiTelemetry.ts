import { type EnrichSpan, OpenTelemetry } from '@ai-sdk/otel';
import { registerTelemetry, type TelemetryOptions } from 'ai';

// GenAI/OTel semconv keys where one exists; team matches setBusinessContext.
const ATTRIBUTION_SPAN_ATTRIBUTES = {
  sessionId: 'gen_ai.conversation.id',
  teamId: 'hyperdx.team.id',
  userId: 'user.id',
} as const;

/**
 * Who an LLM call is attributed to on the LLM dashboard. `sessionId` groups
 * spans into a session on the Sessions tab (use a stable conversation-scoped
 * id) and `userId` feeds per-user attribution.
 */
export type LLMAttribution = {
  [K in keyof typeof ATTRIBUTION_SPAN_ATTRIBUTES]?: string;
};

// The SDK hides runtimeContext keys from telemetry integrations unless they
// are listed here; `satisfies` keeps this in lockstep with the map above.
const INCLUDE_ATTRIBUTION = {
  sessionId: true,
  teamId: true,
  userId: true,
} as const satisfies Record<keyof LLMAttribution, true>;

const SPAN_ATTRIBUTE_BY_KEY: ReadonlyMap<string, string> = new Map(
  Object.entries(ATTRIBUTION_SPAN_ATTRIBUTES),
);

/**
 * `generateText` options that carry `attribution` onto every span of the
 * call.
 */
export function llmTelemetry(
  attribution: LLMAttribution,
  telemetry: Omit<TelemetryOptions, 'includeRuntimeContext'> = {},
) {
  return {
    runtimeContext: attribution,
    telemetry: { ...telemetry, includeRuntimeContext: INCLUDE_ATTRIBUTION },
  } satisfies {
    runtimeContext: LLMAttribution;
    telemetry: TelemetryOptions<LLMAttribution>;
  };
}

export const enrichLLMSpan: EnrichSpan = ({ runtimeContext }) =>
  Object.fromEntries(
    Object.entries(runtimeContext ?? {}).flatMap(([key, value]) => {
      const attribute = SPAN_ATTRIBUTE_BY_KEY.get(key);
      return attribute && typeof value === 'string' && value !== ''
        ? [[attribute, value]]
        : [];
    }),
  );

export function createAITelemetry(
  options: ConstructorParameters<typeof OpenTelemetry>[0] = {},
): OpenTelemetry {
  return new OpenTelemetry({ enrichSpan: enrichLLMSpan, ...options });
}

let registered = false;

/**
 * AI SDK v7 only emits spans through a registered integration.
 * `registerTelemetry` appends, so repeat calls here are no-ops rather than
 * duplicating every span.
 */
export function registerAITelemetry(): void {
  if (registered) return;
  registered = true;
  registerTelemetry(createAITelemetry());
}
