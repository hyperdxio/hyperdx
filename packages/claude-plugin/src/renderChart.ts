import { renderTileContent } from '@hyperdx/cli/src/shared/tileRender';
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import type { ChartCall } from '../types';

import { ansiLines, type Segment } from './ansiLines';
import { toTileResult } from './toTileResult';

const TIME_CHART_ROWS = 14;
const MAX_TABLE_ROWS = 20;

/** Draws a clickstack tool result with the same renderer as `hdx`, or undefined when it can't be charted. */
export function renderChart(
  call: ChartCall,
  columns: number,
): Segment[][] | undefined {
  const result = toTileResult(
    call.tool,
    call.input,
    call.output,
    call.calledAt,
  );
  if (!result) return undefined;

  const { displayType } = result.queriedConfig;
  const height =
    displayType === DisplayType.Number
      ? 3
      : displayType === DisplayType.Line ||
          displayType === DisplayType.StackedBar ||
          displayType === DisplayType.StackedLine
        ? TIME_CHART_ROWS
        : Math.min(result.data.data.length + 2, MAX_TABLE_ROWS);

  try {
    return ansiLines(
      renderTileContent({ result, source: undefined, width: columns, height }),
    );
  } catch {
    // A result the shaping can't read (no timestamp or value column) keeps the engine's own row.
    return undefined;
  }
}
