import { z } from 'zod';

import { measureNodeDeltas } from '@/knowledge/topology/anomaly';
import { toNodeKey } from '@/knowledge/topology/nodeKey';
import { rankRootCauses } from '@/knowledge/topology/rootCause';
import { graphForWindow } from '@/knowledge/topology/window';
import { READ_ONLY_TOOL } from '@/mcp/tools/annotations';
import type { ToolRegistrar } from '@/mcp/tools/types';

import { trimmedJsonResult, windowSchema, withKnowledgeTarget } from './shared';

const NO_DATA_HINT =
  'No spans in this window for the configured trace source. Widen the window or check the source.';
const SELF_HINT =
  'Nothing downstream is anomalous. Look at the service itself: recent deploys, config, resource limits.';

export function rootCauseHint(
  result: ReturnType<typeof rankRootCauses>,
): string | undefined {
  if (result.status === 'no_data') return NO_DATA_HINT;
  const selfOnly =
    result.status === 'ok' &&
    result.candidates.length === 1 &&
    result.candidates[0].depth === 0;
  return selfOnly ? SELF_HINT : undefined;
}

export function registerTraceRootCause({
  context,
  registerTool,
}: ToolRegistrar) {
  registerTool(
    'clickstack_trace_root_cause',
    {
      title: 'Trace root cause through the service graph',
      annotations: READ_ONLY_TOOL,
      description:
        'Given an alerting service and a time window, walk the call graph downstream and rank the services and datastores whose error rate or p95 latency rose against the window before. ' +
        'Deepest anomalous node first. Candidates are leads, not conclusions: verify each in the current window with query tools before acting.',
      inputSchema: z.object({
        service: z
          .string()
          .describe(
            'Alerting service name, or a full node key such as "datastore:postgresql:orders-db".',
          ),
        ...windowSchema,
        topN: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(3)
          .describe('Candidates to return.'),
      }),
    },
    async ({ service, startTime, endTime, topN }) => {
      const start = toNodeKey(service);
      return withKnowledgeTarget(
        context,
        { startTime, endTime },
        async (target, range) => {
          const [graph, deltas] = await Promise.all([
            graphForWindow(target, range),
            measureNodeDeltas(target, range),
          ]);
          const result = rankRootCauses(graph, deltas, start, topN);
          const hint = rootCauseHint(result);
          return trimmedJsonResult({ ...result, ...(hint && { hint }) });
        },
      );
    },
  );
}
