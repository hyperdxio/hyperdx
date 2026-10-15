import type { ResponseJSON } from '@hyperdx/common-utils/dist/clickhouse';
import type { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
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

type ToolInput = {
  shape?: string;
  select?: unknown[];
  groupBy?: string;
  granularity?: string;
  startTime?: string;
  endTime?: string;
};

type ChartResult = Extract<TileQueryResult, { status: 'ok' }>;

/** Matches by MCP tool name suffix, so it works whatever the user named the server. */
export function chartedTool(toolName: string): string | undefined {
  const suffix = toolName.split('__').pop() ?? '';
  return suffix in DISPLAY_TYPES ? suffix : undefined;
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

/** The smallest gap between bucket timestamps, as the server's "<n> second" interval. */
function inferGranularity(rows: Record<string, unknown>[]): string | undefined {
  const times = [...new Set(rows.map(r => Date.parse(String(r[TIME_BUCKET]))))]
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const gaps = times.slice(1).map((t, i) => t - times[i]!);
  return gaps.length ? `${Math.min(...gaps) / 1000} second` : undefined;
}
