import { atom, read, update } from 'claude-code';
import type {
  EngineInterface,
  Register,
  RenderElement,
  RenderInput,
} from 'claude-code';

import type { ChartCall } from '../types';

import { chartedTool, renderChart, stripControlChars } from './chart.js';

const KEEP = 20;
const MAX_COLUMNS = 140;
const calls = atom({ plugin: 'hyperdx-charts', key: 'calls' } as const, {});

type Row = { id: string; tool: string; input: unknown };

function chartTree(
  $: EngineInterface,
  e: RenderInput,
  row: Row,
  call: ChartCall,
): RenderElement | undefined {
  const columns = Math.min(
    MAX_COLUMNS,
    Math.max(40, (e.viewport?.columns ?? 80) - 6),
  );
  const lines = renderChart(call, columns);
  if (!lines) return undefined;
  const { Box, Text } = $.ui.resolve(e);
  const reason = (row.input as { reason?: unknown } | undefined)?.reason;
  return (
    <Box flexDirection="column" key={`chart-${row.id}`}>
      <Text>
        <Text bold>{stripControlChars(row.tool.split('__').pop() ?? '')}</Text>
        {typeof reason === 'string' && (
          <Text dimColor> {stripControlChars(reason)}</Text>
        )}
      </Text>
      {lines.map(segments => (
        <Text wrap="truncate">
          {segments.length === 0
            ? ' '
            : segments.map(s => (
                <Text color={s.color} dimColor={s.dim} bold={s.bold}>
                  {s.text}
                </Text>
              ))}
        </Text>
      ))}
    </Box>
  );
}

// Charted rows replace the engine's row and its JSON; the model still reads the full result.
async function drawRows(
  $: EngineInterface,
  e: RenderInput,
  next: () => Promise<RenderElement>,
  rows: Row[],
  isEveryRowCharted: boolean,
) {
  if (e.surface !== 'terminal' || rows.length === 0) return next();
  const stored = await read($, calls);
  const drawn = rows.flatMap(row => {
    const call = stored[row.id];
    return (call && chartTree($, e, row, call)) || [];
  });
  if (drawn.length === 0) return next();
  const { Box } = $.ui.resolve(e);
  return (
    <Box flexDirection="column">
      {!(isEveryRowCharted && drawn.length === rows.length) && (await next())}
      {drawn}
    </Box>
  );
}

export const register: Register = on => {
  on('tool.call', async ($, e, next) => {
    const ran = await next(e);
    if (!chartedTool(e.tool) || ran.deny !== undefined || ran.isError)
      return ran;
    const call: ChartCall = {
      tool: e.tool,
      input: e,
      output: ran.result,
      calledAt: Date.now(),
    };
    // Chart bookkeeping must never fail the call it watched.
    try {
      await update($, calls, all =>
        Object.fromEntries(
          [...Object.entries(all), [e.tool_use_id, call]].slice(-KEEP),
        ),
      );
    } catch {
      // The row keeps the engine's own rendering.
    }
    return ran;
  }).catch(($, e, next) => next(e));

  // MCP calls draw as a collapsed group line; an expanded group draws its rows, which chart themselves.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const rows = e.props.isExpanded
      ? []
      : e.props.calls.flatMap(c =>
          chartedTool(c.tool) && c.tool_use_id
            ? [{ id: c.tool_use_id, tool: c.tool, input: c.input }]
            : [],
        );
    return drawRows(
      $,
      e,
      () => next(e),
      rows,
      rows.length === e.props.calls.length,
    );
  });

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const rows = chartedTool(e.props.tool)
      ? [{ id: e.props.tool_use_id, tool: e.props.tool, input: e.props.input }]
      : [];
    return drawRows($, e, () => next(e), rows, true);
  });
};
