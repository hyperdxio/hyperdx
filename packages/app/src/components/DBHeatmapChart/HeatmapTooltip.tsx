import { Divider, Text } from '@mantine/core';

import { FormatTime } from '@/useFormatTime';

import type { HighlightedPoint } from './highlightDataPlugin';

/** What the hovered cell holds: a series' value, or a y bucket's count. */
export type HeatmapTooltipCell =
  | { kind: 'series'; name: string; formattedValue: string }
  | {
      kind: 'distribution';
      formattedY: string;
      percentile: number | undefined;
    };

type HeatmapTooltipProps = {
  point: HighlightedPoint;
  cell: HeatmapTooltipCell;
  /** Chart container size, used to keep the tooltip inside it. */
  width: number;
  height: number;
  showDragHint: boolean;
};

export function HeatmapTooltip({
  point,
  cell,
  width,
  height,
  showDragHint,
}: HeatmapTooltipProps) {
  return (
    <>
      <div
        style={{
          position: 'absolute',
          top: point.yCoord - point.ySize / 2,
          left: point.xCoord - point.xSize / 2,
          width: point.xSize,
          height: point.ySize,
          pointerEvents: 'none',
          background: 'var(--mantine-color-default-hover)',
        }}
      />
      <div
        className="px-2 py-1 fs-8"
        style={{
          position: 'absolute',
          // Clamp so the tooltip stays within the chart container
          top: Math.min(point.yCoord + 5, height - 90),
          ...(point.xCoord > width / 2
            ? {
                right: width - point.xCoord + 10,
              }
            : {
                left: point.xCoord + 10,
              }),
          maxWidth: '50%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap' as const,
          backdropFilter: 'blur(8px)',
          backgroundColor: 'var(--mantine-color-body)',
          border: '1px solid var(--mantine-color-default-border)',
          borderRadius: 4,
          pointerEvents: 'none',
        }}
      >
        {showDragHint && (
          <>
            <Text size="10px" pt="4px">
              Drag to Compare · Click to Clear
            </Text>
            <Divider my="xs" />
          </>
        )}
        <div>
          <FormatTime value={point.xVal} />
        </div>
        {cell.kind === 'series' ? (
          <>
            <div>
              <b>Series:</b> {cell.name}
            </div>
            <div>
              <b>Value:</b> {cell.formattedValue}
            </div>
          </>
        ) : (
          <>
            <div>
              <b>Y Value:</b> {cell.formattedY}
              {cell.percentile != null &&
                ` (p${new Intl.NumberFormat('en-US', {
                  maximumFractionDigits: 1,
                }).format(cell.percentile)})`}
            </div>
            <div>
              <b>Count Value:</b>{' '}
              {new Intl.NumberFormat('en-US', {
                notation: 'standard',
                compactDisplay: 'short',
              }).format(point.countVal)}
            </div>
          </>
        )}
      </div>
    </>
  );
}
