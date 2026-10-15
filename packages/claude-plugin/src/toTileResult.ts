import type { ResponseJSON } from '@hyperdx/common-utils/dist/clickhouse';
import type { HeatmapGrid } from '@hyperdx/common-utils/dist/core/heatmap';
import type {
  ChartConfigWithDateRange,
  NumberFormat,
} from '@hyperdx/common-utils/dist/types';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import type { TileQueryResult } from '@hyperdx/cli/src/shared/tileQuery';

const TIME_BUCKET = '__hdx_time_bucket';
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

// Builder tools whose shape input picks the chart.
const DISPLAY_TYPES: Record<string, Record<string, DisplayType>> = {
  clickstack_timeseries: {
    line: DisplayType.Line,
    stacked_bar: DisplayType.StackedBar,
    stacked_line: DisplayType.StackedLine,
  },
  clickstack_table: {
    table: DisplayType.Table,
    number: DisplayType.Number,
    pie: DisplayType.Pie,
    bar: DisplayType.Bar,
  },
};

// Tools answering with a `heatmap` grid. A query_tile result for any other
// tile carries no display type, so it is left alone.
const HEATMAP_TOOLS = ['clickstack_heatmap', 'clickstack_query_tile'];

type ToolInput = {
  shape?: string;
  select?: unknown[];
  groupBy?: string;
  granularity?: string;
  startTime?: string;
  endTime?: string;
};

type HeatmapBody = {
  numberFormat?: NumberFormat;
  times: string[];
  valueEdges: number[];
  counts: number[][];
  scale: 'log' | 'linear';
};

type ChartResult = Extract<TileQueryResult, { status: 'ok' | 'heatmap' }>;

/** Matches by MCP tool name suffix, so it works whatever the user named the server. */
export function chartedTool(toolName: string): string | undefined {
  const suffix = toolName.split('__').pop() ?? '';
  return suffix in DISPLAY_TYPES || HEATMAP_TOOLS.includes(suffix)
    ? suffix
    : undefined;
}

/** MCP output arrives as text blocks holding one JSON document. */
function parseBody(output: unknown): Record<string, unknown> | undefined {
  const blocks = Array.isArray(output)
    ? output
    : (output as { content?: unknown })?.content;
  if (!Array.isArray(blocks)) return undefined;
  const text = blocks.map(b => (b as { text?: unknown })?.text ?? '').join('');
  try {
    const body = JSON.parse(text);
    return body && typeof body === 'object' ? body : undefined;
  } catch {
    return undefined;
  }
}

/** The builder tools answer `{ result: ResponseJSON, ... }`. */
export function parseResponse(
  output: unknown,
): ResponseJSON<Record<string, string | number>> | undefined {
  const result = parseBody(output)?.result as ResponseJSON | undefined;
  return Array.isArray(result?.meta) && Array.isArray(result?.data)
    ? (result as ResponseJSON<Record<string, string | number>>)
    : undefined;
}

/**
 * Rebuilds what the server queried from the tool call, so the CLI's tile
 * renderer can draw the result exactly as `hdx` would.
 */
export function toTileResult(
  toolName: string,
  input: unknown,
  output: unknown,
  calledAt: number,
): ChartResult | undefined {
  const tool = chartedTool(toolName);
  if (!tool) return undefined;
  const args = (input ?? {}) as ToolInput;
  const end = args.endTime ? new Date(args.endTime) : new Date(calledAt);
  const start = args.startTime
    ? new Date(args.startTime)
    : new Date(end.getTime() - DEFAULT_WINDOW_MS);

  if (HEATMAP_TOOLS.includes(tool)) {
    const heatmap = parseBody(output)?.heatmap as HeatmapBody | undefined;
    if (!heatmap?.counts?.length) return undefined;
    return {
      status: 'heatmap',
      queriedConfig: {
        displayType: DisplayType.Heatmap,
        dateRange: [start, end],
        numberFormat: heatmap.numberFormat,
      } as unknown as ChartConfigWithDateRange,
      grid: toGrid(heatmap),
    };
  }

  const data = parseResponse(output);
  if (!data || data.data.length === 0) return undefined;
  const shapes = DISPLAY_TYPES[tool]!;
  const displayType = shapes[args.shape ?? Object.keys(shapes)[0]!];
  if (!displayType) return undefined;
  const granularity = args.granularity ?? inferGranularity(data.data);

  const queriedConfig = {
    displayType,
    dateRange: [start, end],
    granularity,
    // Without a known bucket size, filling empty buckets would invent zeros.
    fillNulls: granularity ? undefined : false,
    select: args.select ?? [],
    groupBy: args.groupBy,
  } as unknown as ChartConfigWithDateRange;

  return { status: 'ok', queriedConfig, data };
}

function toGrid({
  times,
  valueEdges,
  counts,
  scale,
}: HeatmapBody): HeatmapGrid {
  const ms = times.map(t => Date.parse(t));
  return {
    times: ms,
    stepMs: ms.length > 1 ? ms[1]! - ms[0]! : 0,
    yAxis: { type: 'numeric', scale, edges: withOuterRows(valueEdges, scale) },
    cells: counts.flat(),
  };
}

// The server reports the bucket bounds, with an under- and overflow count on
// either side; give those two rows one bucket's height so they can be drawn.
function withOuterRows(edges: number[], scale: 'log' | 'linear'): number[] {
  const [first, second] = [edges[0]!, edges[1] ?? edges[0]!];
  const [beforeLast, last] = [edges.at(-2) ?? edges.at(-1)!, edges.at(-1)!];
  return scale === 'log' && first > 0
    ? [(first * first) / second, ...edges, (last * last) / beforeLast]
    : [first - (second - first), ...edges, last + (last - beforeLast)];
}

/** The smallest gap between bucket timestamps, as the server's "<n> second" interval. */
function inferGranularity(rows: Record<string, unknown>[]): string | undefined {
  const times = [...new Set(rows.map(r => Date.parse(String(r[TIME_BUCKET]))))]
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const gaps = times.slice(1).map((t, i) => t - times[i]!);
  return gaps.length ? `${Math.min(...gaps) / 1000} second` : undefined;
}
