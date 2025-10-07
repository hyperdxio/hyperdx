import type { SavedChartConfig } from '@hyperdx/common-utils/dist/types';
import { useMutation } from '@tanstack/react-query';

import { hdxServer } from '@/api';

type AssistantInput = {
  sourceId: string;
  text: string;
};

export function useChartAssistant() {
  return useMutation<SavedChartConfig, Error, AssistantInput>({
    mutationFn: async ({ sourceId, text }: AssistantInput) =>
      hdxServer('ai/assistant', {
        method: 'POST',
        json: { sourceId, text },
      }).json<SavedChartConfig>(),
  });
}
