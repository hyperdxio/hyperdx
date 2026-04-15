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

type SummarizeInput = {
  type: 'event' | 'pattern';
  content: string;
  tone?: 'default' | 'noir' | 'attenborough' | 'shakespeare';
};

type SummarizeResponse = {
  summary: string;
};

export function useAISummarize() {
  return useMutation<SummarizeResponse, Error, SummarizeInput>({
    mutationFn: async ({ type, content, tone }: SummarizeInput) =>
      hdxServer('ai/summarize', {
        method: 'POST',
        json: { type, content, ...(tone && tone !== 'default' && { tone }) },
      }).json<SummarizeResponse>(),
  });
}
