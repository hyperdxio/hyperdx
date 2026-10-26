import { embed } from 'ai';

import { getEmbeddingModel } from '@/controllers/ai';
import type { IncidentRow } from '@/knowledge/incidents/types';

export const incidentEmbeddingText = (
  i: Pick<IncidentRow, 'title' | 'summary' | 'root_cause' | 'resolution'>,
) => `${i.title}\n${i.summary}\n${i.root_cause}\n${i.resolution}`;

// Null when no provider is configured or there is nothing to embed. Provider
// errors propagate; callers treat embeddings as optional and catch them.
export async function embedText(text: string): Promise<number[] | null> {
  const model = getEmbeddingModel();
  if (!model || !text.trim()) return null;
  const { embedding } = await embed({
    model,
    value: text,
    maxRetries: 2,
    abortSignal: AbortSignal.timeout(10_000),
  });
  return embedding;
}
