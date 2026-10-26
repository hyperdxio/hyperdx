import { z } from 'zod';

import { findSimilarIncidents } from '@/knowledge/incidents/find';
import { buildPlaybook } from '@/knowledge/incidents/playbook';
import { listActions } from '@/knowledge/incidents/store';
import { measureNodeDeltas } from '@/knowledge/topology/anomaly';
import { toNodeKey } from '@/knowledge/topology/nodeKey';
import { blastRadius, rankRootCauses } from '@/knowledge/topology/rootCause';
import { graphForWindow } from '@/knowledge/topology/window';
import { READ_ONLY_TOOL } from '@/mcp/tools/annotations';
import type { ToolRegistrar } from '@/mcp/tools/types';

import { summarizeIncident } from './findSimilar';
import { rootCauseHint } from './rootCause';
import { trimmedJsonResult, windowSchema, withKnowledgeTarget } from './shared';

export function registerIncidentContext({
  context,
  registerTool,
}: ToolRegistrar) {
  registerTool(
    'clickstack_incident_context',
    {
      title: 'Get incident context',
      annotations: READ_ONLY_TOOL,
      description:
        'Start an alert investigation here. For an alerting service and time window, returns the root cause ranking, the blast radius and up to 3 confirmed past incidents with their playbooks. ' +
        'The blast radius lists the callers of the top root cause candidate, or of the alerting service when there is none; blastRadiusFrom names that node. ' +
        'Everything is a lead, not a conclusion: verify each candidate and playbook step in the current window before acting.',
      inputSchema: z.object({
        service: z
          .string()
          .min(1)
          .describe(
            'Alerting service name, or a full node key such as "datastore:postgresql:orders-db".',
          ),
        ...windowSchema,
        symptomKeys: z
          .array(z.string())
          .optional()
          .describe('Node keys seen in the current symptoms.'),
        text: z
          .string()
          .optional()
          .describe(
            'Symptom description, matched against past incident text when an embedding provider is configured.',
          ),
      }),
    },
    async ({ service, startTime, endTime, symptomKeys, text }) => {
      const start = toNodeKey(service);
      return withKnowledgeTarget(
        context,
        { startTime, endTime },
        async (target, range) => {
          const [graph, deltas, matches] = await Promise.all([
            graphForWindow(target, range),
            measureNodeDeltas(target, range),
            findSimilarIncidents(target, {
              service,
              text,
              symptomKeys,
              topK: 3,
            }),
          ]);
          const rootCause = rankRootCauses(graph, deltas, start, 3);
          const hint = rootCauseHint(rootCause);
          const blastRadiusFrom =
            (rootCause.status === 'ok' && rootCause.candidates[0]?.node) ||
            start;
          const similar = await Promise.all(
            matches.map(async m => ({
              ...summarizeIncident(m),
              playbook: buildPlaybook(
                m.incident,
                await listActions(target, m.incident.incident_id),
              ),
            })),
          );
          return trimmedJsonResult({
            rootCause: { ...rootCause, ...(hint && { hint }) },
            blastRadiusFrom,
            blastRadius: blastRadius(graph, deltas, blastRadiusFrom),
            similar,
          });
        },
      );
    },
  );
}
