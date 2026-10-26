import { z } from 'zod';

import { findSimilarIncidents } from '@/knowledge/incidents/find';
import type { ScoredIncident } from '@/knowledge/incidents/similarity';
import { READ_ONLY_TOOL } from '@/mcp/tools/annotations';
import type { ToolRegistrar } from '@/mcp/tools/types';

import { jsonResult, withTarget } from './shared';

export const summarizeIncident = ({
  incident: i,
  score,
  terms,
}: ScoredIncident) => ({
  incidentId: i.incident_id,
  title: i.title,
  score,
  terms,
  rootCause: i.root_cause,
  rootCauseNode: i.root_cause_node,
  resolution: i.resolution,
  resolvedAt: i.resolved_at,
});

export function registerFindSimilar({ context, registerTool }: ToolRegistrar) {
  registerTool(
    'clickstack_find_similar_incidents',
    {
      title: 'Find similar past incidents',
      annotations: READ_ONLY_TOOL,
      description:
        'Rank confirmed past incidents by overlap in symptoms, closeness in the service graph and age. ' +
        'Treat matches as hypotheses with a prior, not as the answer. Confirm the past root cause in the current window before repeating its fix.',
      inputSchema: z.object({
        service: z
          .string()
          .min(1)
          .describe(
            'Alerting service name, or a full node key such as "datastore:postgresql:orders-db".',
          ),
        text: z
          .string()
          .optional()
          .describe(
            'Symptom description, matched against past incident text when an embedding provider is configured.',
          ),
        symptomKeys: z
          .array(z.string())
          .optional()
          .describe('Node keys seen in the current symptoms.'),
        topK: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(5)
          .describe('Matches to return.'),
      }),
    },
    async ({ service, text, symptomKeys, topK }) =>
      withTarget(context, async t => {
        const hits = await findSimilarIncidents(t, {
          service,
          text,
          symptomKeys,
          topK,
        });
        return jsonResult(hits.map(summarizeIncident));
      }),
  );
}
