import type { queryDistributionHeatmap } from '@hyperdx/common-utils/dist/core/distributionHeatmap';
import {
  type HeatmapScaleType,
  toHeatmapResult,
} from '@hyperdx/common-utils/dist/core/heatmap';
import type {
  BuilderSavedChartConfig,
  NumberFormat,
  TSource,
} from '@hyperdx/common-utils/dist/types';

import type { ToolResult } from '@/mcp/tools/types';

// Sized for an agent's context rather than a screen: ~48 x 22 counts.
export const MCP_HEATMAP_TIME_BUCKETS = 48;
export const MCP_HEATMAP_VALUE_BUCKETS = 20;

function readingHint(scale: HeatmapScaleType) {
  return (
    'valueEdges are in the units of valueExpression (when numberFormat.factor is ' +
    'present, value x factor is seconds). counts[t] has one entry per range: ' +
    'counts[t][0] counts values below valueEdges[0], counts[t][r] counts values in ' +
    '[valueEdges[r - 1], valueEdges[r]), and the last entry counts values at or ' +
    'above the last edge.' +
    (scale === 'log'
      ? ' On this log scale values below valueEdges[0] are counted in counts[t][1].'
      : '')
  );
}

/** A trace duration column formats as a duration unless the tile says otherwise. */
export function heatmapNumberFormat(
  config: Pick<BuilderSavedChartConfig, 'numberFormat'>,
  source: TSource,
  valueExpression: string,
): NumberFormat | undefined {
  if (config.numberFormat) return config.numberFormat;
  if (
    'durationExpression' in source &&
    valueExpression === source.durationExpression
  ) {
    return {
      output: 'duration',
      factor: Math.pow(10, -(source.durationPrecision ?? 9)),
    };
  }
  return undefined;
}

/** A distribution heatmap as compact JSON an agent can read range by range. */
export function formatHeatmapResult(
  {
    heatmap,
    granularity,
    granularityNote,
  }: Awaited<ReturnType<typeof queryDistributionHeatmap>>,
  {
    valueExpression,
    numberFormat,
  }: { valueExpression: string; numberFormat?: NumberFormat },
): ToolResult {
  const notes = granularityNote ? [granularityNote] : [];
  const body = heatmap
    ? {
        heatmap: toHeatmapResult(heatmap, {
          valueExpression,
          granularity,
          numberFormat,
        }),
        hints: [readingHint(heatmap.scaleType), ...notes],
      }
    : {
        heatmap: null,
        hints: [
          `Not enough distinct values of ${valueExpression} in the time range to bucket. ` +
            'Widen startTime/endTime or check the value expression.',
          ...notes,
        ],
      };
  return { content: [{ type: 'text', text: JSON.stringify(body) }] };
}
