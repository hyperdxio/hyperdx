import { Divider, Text } from '@mantine/core';

import { FormatTime } from '@/useFormatTime';

import type { HighlightedPoint } from './highlightDataPlugin';

type HeatmapTooltipProps = {
  point: HighlightedPoint;
  /** Chart container size, used to keep the tooltip inside it. */
  width: number;
  height: number;
  showDragHint: boolean;
  formatY: (value: number) => string;
  percentile: number | undefined;
};

export function HeatmapTooltip({
  point,
  width,
  height,
  showDragHint,
  formatY,
  percentile,
}: HeatmapTooltipProps) {
  return (
    <>
      <div
        style={{
          position: 'absolute',
          top: point.yCoord,
          // TODO: This seems to be off by a few pixels depending on scale
          left: point.xCoord,
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
        <div>
          <b>Y Value:</b> {formatY(point.yVal)}
          {percentile != null &&
            ` (p${new Intl.NumberFormat('en-US', {
              maximumFractionDigits: 1,
            }).format(percentile)})`}
        </div>
        <div>
          <b>Count Value:</b>{' '}
          {new Intl.NumberFormat('en-US', {
            notation: 'standard',
            compactDisplay: 'short',
          }).format(point.countVal)}
        </div>
      </div>
    </>
  );
}
