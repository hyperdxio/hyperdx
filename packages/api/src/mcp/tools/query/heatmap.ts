import { SQLIntervalSchema } from '@hyperdx/common-utils/dist/types';
import { z } from 'zod';

import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpUserError } from '@/mcp/utils/errors';

import { buildTile, parseTimeRange, runConfigTile } from './helpers';
import {
  endTimeSchema,
  sourceIdSchema,
  startTimeSchema,
  whereLanguageSchema,
  whereSchema,
} from './schemas';

const heatmapSchema = z.object({
  sourceId: sourceIdSchema.describe(
    'Trace source ID. Distribution heatmaps need a trace source; call clickstack_list_sources to find one.',
  ),
  valueExpression: z
    .string()
    .min(1)
    .describe(
      'Numeric column or expression to bucket, e.g. "Duration" for span latency. ' +
        'Top-level columns are PascalCase; map attributes use bracket syntax.',
    ),
  countExpression: z
    .string()
    .optional()
    .describe('What each cell counts. Default: count() (one per span).'),
  scale: z
    .enum(['log', 'linear'])
    .optional()
    .default('log')
    .describe(
      'Value axis scale. "log" (default) suits latency, which spans orders of magnitude.',
    ),
  where: whereSchema.describe('Row filter, e.g. restrict to one service.'),
  whereLanguage: whereLanguageSchema,
  granularity: SQLIntervalSchema.optional().describe(
    'Time bucket size, "<number> <unit>" where unit is second, minute, hour or day ' +
      '(e.g. "5 minute"). Omit to pick one for ~48 buckets; a size that would make ' +
      'far more buckets is coarsened, with a hint.',
  ),
  startTime: startTimeSchema,
  endTime: endTimeSchema,
});

export function registerHeatmap({ context, registerTool }: ToolRegistrar) {
  const { teamId } = context;

  registerTool(
    'clickstack_heatmap',
    {
      title: 'Distribution Heatmap',
      annotations: { readOnlyHint: true },
      description:
        'Show how a numeric value is distributed over time: counts of events per ' +
        'time bucket and value range, as on a latency heatmap. Use this to see ' +
        'bimodal latency, a slow tail appearing, or a shift in the whole ' +
        'distribution, which a single percentile line hides. ' +
        'Requires a trace source. Returns counts[t][r] with the time buckets and ' +
        'value-range edges they belong to.',
      inputSchema: heatmapSchema,
    },
    async input => {
      const timeRange = parseTimeRange(input.startTime, input.endTime);
      if ('error' in timeRange) {
        return mcpUserError(timeRange.error);
      }

      const tile = buildTile('MCP Heatmap', 12, 6, {
        displayType: 'heatmap',
        sourceId: input.sourceId,
        select: [
          {
            valueExpression: input.valueExpression,
            countExpression: input.countExpression,
            heatmapScaleType: input.scale,
          },
        ],
        where: input.where,
        whereLanguage: input.whereLanguage,
      });

      return runConfigTile(
        teamId.toString(),
        tile,
        timeRange.startDate,
        timeRange.endDate,
        { granularity: input.granularity },
      );
    },
  );
}
