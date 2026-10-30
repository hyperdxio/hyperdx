import type { ResponseJSON } from '@hyperdx/common-utils/dist/clickhouse';
import type { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { TIME_SERIES_DISPLAY_TYPE_BY_NAME } from '@hyperdx/common-utils/dist/core/utils';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import type { TileQueryResult } from '@hyperdx/cli/src/shared/tileQuery';

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
// clickstack_table turns these into a table when given more than one select item.
const SINGLE_SERIES_SHAPES = ['number', 'pie', 'bar'];

// Builder tools whose shape input picks the chart.
const DISPLAY_TYPES: Record<string, Record<string, DisplayType>> = {
  clickstack_timeseries: TIME_SERIES_DISPLAY_TYPE_BY_NAME,
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

/** The server trims results over its size limit and says so in `note`. */
export function isTrimmed(output: unknown): boolean {
  return typeof parseBody(output)?.note === 'string';
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
  const select = args.select ?? [];
  const shape =
    tool === 'clickstack_table' &&
    select.length > 1 &&
    SINGLE_SERIES_SHAPES.includes(args.shape ?? '')
      ? 'table'
      : (args.shape ?? Object.keys(shapes)[0]!);
  const displayType = shapes[shape];
  if (!displayType) return undefined;

  const queriedConfig = {
    displayType,
    dateRange: [start, end],
    granularity: args.granularity,
    // Empty buckets are filled only when their alignment is known: an explicit
    // granularity and every row present. Otherwise filling would invent zeros.
    fillNulls: args.granularity && !isTrimmed(output) ? undefined : false,
    select,
    groupBy: args.groupBy,
  } as unknown as ChartConfigWithDateRange;

  return { status: 'ok', queriedConfig, data };
}
