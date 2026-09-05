import { ActionIcon, Tooltip } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';

interface HiddenSeriesIndicatorProps {
  hiddenSeriesCount: number;
  renderedSeriesCount: number;
  /** Render every series, bypassing the cap. Omit to keep the notice passive. */
  onLoadAll?: () => void;
}

/**
 * Warns that the chart returned more series than the client renders. The
 * transform caps series to protect memory; this surfaces the dropped ones and,
 * when `onLoadAll` is provided, lets the user render all of them anyway.
 */
export default function HiddenSeriesIndicator({
  hiddenSeriesCount,
  renderedSeriesCount,
  onLoadAll,
}: HiddenSeriesIndicatorProps) {
  if (hiddenSeriesCount <= 0) {
    return null;
  }

  const total = renderedSeriesCount + hiddenSeriesCount;
  const label =
    `This query returned ${total.toLocaleString()} series. ` +
    `${hiddenSeriesCount.toLocaleString()} low-value series were hidden to keep the page responsive; ` +
    `showing the top ${renderedSeriesCount.toLocaleString()} by peak value. ` +
    (onLoadAll
      ? `Click to load all ${total.toLocaleString()} (may be slow).`
      : 'Add a stricter GROUP BY, a WHERE filter, or a series limit to reduce cardinality.');

  const icon = (
    <IconAlertTriangle size={16} color="var(--color-text-warning)" />
  );

  return (
    <Tooltip multiline maw={500} label={label}>
      {onLoadAll ? (
        <ActionIcon
          variant="subtle"
          size="sm"
          onClick={onLoadAll}
          // Toolbar sits in react-grid-layout's drag subtree; stop propagation
          // (as ChartContainer does) so a click doesn't start a tile drag.
          onMouseDown={e => e.stopPropagation()}
          aria-label={`Load all ${total.toLocaleString()} series`}
        >
          {icon}
        </ActionIcon>
      ) : (
        icon
      )}
    </Tooltip>
  );
}
