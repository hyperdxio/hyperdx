import { z } from 'zod';

import { measureNodeDeltas } from '@/knowledge/topology/anomaly';
import { toNodeKey } from '@/knowledge/topology/nodeKey';
import { blastRadius } from '@/knowledge/topology/rootCause';
import { graphForWindow } from '@/knowledge/topology/window';
import { READ_ONLY_TOOL } from '@/mcp/tools/annotations';
import type { ToolRegistrar } from '@/mcp/tools/types';

import { jsonResult, windowSchema, withKnowledgeTarget } from './shared';

export function registerBlastRadius({ context, registerTool }: ToolRegistrar) {
  registerTool(
    'clickstack_blast_radius',
    {
      title: 'Blast radius of a failing node',
      annotations: READ_ONLY_TOOL,
      description:
        'List the upstream services that depend on a service or datastore, nearest first, with how far their error rate and p95 latency moved in the window. ' +
        'Use it to see who is affected by a failing dependency.',
      inputSchema: z.object({
        node: z
          .string()
          .describe(
            'Service name, or a full node key such as "datastore:postgresql:orders-db".',
          ),
        ...windowSchema,
      }),
    },
    async ({ node, startTime, endTime }) => {
      const start = toNodeKey(node);
      return withKnowledgeTarget(
        context,
        { startTime, endTime },
        async (target, range) => {
          const [graph, deltas] = await Promise.all([
            graphForWindow(target, range),
            measureNodeDeltas(target, range),
          ]);
          return jsonResult(blastRadius(graph, deltas, start));
        },
      );
    },
  );
}
