import { embedText } from '@/knowledge/incidents/embedding';
import { listIncidents } from '@/knowledge/incidents/listing';
import {
  rankIncidents,
  type ScoredIncident,
} from '@/knowledge/incidents/similarity';
import type { KnowledgeTarget } from '@/knowledge/target';
import { loadGraph } from '@/knowledge/topology/graph';
import { toNodeKey } from '@/knowledge/topology/nodeKey';
import logger from '@/utils/logger';

// Reads the stored graph without refreshing it. The service's own node key is always a symptom.
export async function findSimilarIncidents(
  target: KnowledgeTarget,
  opts: {
    service: string;
    text?: string;
    symptomKeys?: string[];
    includeUnconfirmed?: boolean;
    topK?: number;
  },
): Promise<ScoredIncident[]> {
  const embedding = await embedText(opts.text ?? '').catch(err => {
    logger.warn(
      { err, teamId: target.teamId },
      'query embedding failed, ranking without text',
    );
    return null;
  });
  const [graph, incidents] = await Promise.all([
    loadGraph(target),
    listIncidents(target, {
      status: 'resolved',
      includeUnconfirmed: Boolean(
        opts.includeUnconfirmed || target.includeUnconfirmed,
      ),
      withEmbedding: embedding !== null,
    }),
  ]);
  const node = toNodeKey(opts.service);
  return rankIncidents(
    {
      node,
      symptomKeys: [...new Set([...(opts.symptomKeys ?? []), node])],
      now: new Date(),
      ...(embedding && { embedding }),
    },
    incidents,
    graph,
    { topK: opts.topK },
  );
}
