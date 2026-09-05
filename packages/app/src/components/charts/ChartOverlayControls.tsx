import { Button, Tooltip as MantineTooltip } from '@mantine/core';
import { IconArrowsMaximize, IconZoomReset } from '@tabler/icons-react';

/**
 * Floating top-right chart controls (clear-focus + reset-zoom). Each button
 * renders only when its handler is supplied, so a handler-less button can't
 * appear and the caller needs no surrounding guard.
 */
export function ChartOverlayControls({
  onClearSelection,
  onResetZoom,
}: {
  onClearSelection?: () => void;
  onResetZoom?: () => void;
}) {
  if (onClearSelection == null && onResetZoom == null) {
    return null;
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 4,
        right: 8,
        zIndex: 2,
        display: 'flex',
        gap: 4,
      }}
    >
      {onClearSelection != null ? (
        <Button
          variant="secondary"
          size="compact-xs"
          leftSection={<IconArrowsMaximize size={14} />}
          onClick={onClearSelection}
          data-testid="chart-clear-series-selection"
        >
          Show All Series
        </Button>
      ) : null}
      {onResetZoom != null ? (
        <MantineTooltip label="Reset to the range before zooming in" withArrow>
          <Button
            variant="secondary"
            size="compact-xs"
            leftSection={<IconZoomReset size={14} />}
            onClick={onResetZoom}
          >
            Reset zoom
          </Button>
        </MantineTooltip>
      ) : null}
    </div>
  );
}
