import type { AILineTableResponse } from '@hyperdx/common-utils/dist/types';
import { useMutation } from '@tanstack/react-query';

import { hdxServer } from '@/api';

type AssistantInput = {
  sourceId: string;
  text: string;
};

export function useChartAssistant() {
  return useMutation<AILineTableResponse, Error, AssistantInput>({
    mutationFn: async ({ sourceId, text }: AssistantInput) =>
      hdxServer('ai/assistant', {
        method: 'POST',
        json: { sourceId, text },
      }).json<AILineTableResponse>(),
  });
}

// Kinds supported by POST /ai/summarize. Add new subjects here AND register a
// matching prompt in the API (packages/api/src/routers/api/ai.ts).
export type SummarizeKind = 'event' | 'pattern' | 'alert';

export type AISummarizeTone =
  | 'default'
  | 'noir'
  | 'attenborough'
  | 'shakespeare';

// Optional conversation history for future follow-up-question flows.
// Not wired to any UI today, but the shape is fixed so the server API does
// not need to change when we add it.
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

type SummarizeInput = {
  kind: SummarizeKind;
  content: string;
  tone?: AISummarizeTone;
  messages?: ConversationMessage[];
};

type SummarizeResponse = {
  summary: string;
};

export function useAISummarize() {
  return useMutation<SummarizeResponse, Error, SummarizeInput>({
    mutationFn: async ({ kind, content, tone, messages }: SummarizeInput) =>
      hdxServer('ai/summarize', {
        method: 'POST',
        json: {
          kind,
          content,
          ...(tone && tone !== 'default' && { tone }),
          ...(messages && messages.length > 0 && { messages }),
        },
      }).json<SummarizeResponse>(),
  });
}
