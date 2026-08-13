import { ActionIcon, Tooltip } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';

interface HiddenSeriesIndicatorProps {
  hiddenSeriesCount: number;
  renderedSeriesCount: number;
  /** Total rows returned, shown alongside the series counts. Omit if unknown. */
  rowCount?: number;
  /**
   * True when the query hit the row cap (see ResultOverflowBanner). Then the
   * copy drops the "all series were loaded" claim, since the result is a subset.
   */
  resultWasCapped?: boolean;
  /** Render every series, bypassing the cap. Omit to keep the notice passive. */
  onLoadAll?: () => void;
}

/**
 * Notice that the chart drew only the top-N series (by peak value) to stay
 * readable; `onLoadAll` lets the user draw all of them. Contrast
 * ResultOverflowBanner (row cap — data the query may not have fetched).
 */
export default function HiddenSeriesIndicator({
  hiddenSeriesCount,
  renderedSeriesCount,
  rowCount,
  resultWasCapped,
  onLoadAll,
}: HiddenSeriesIndicatorProps) {
  if (hiddenSeriesCount <= 0) {
    return null;
  }

  const total = renderedSeriesCount + hiddenSeriesCount;
  const rowsDetail =
    typeof rowCount === 'number'
      ? ` (from ${rowCount.toLocaleString()} rows)`
      : '';
  // When capped, don't claim "all series were loaded" (the result is a subset).
  const completenessClause = resultWasCapped
    ? `Of the ${total.toLocaleString()} series in the loaded (capped) result, ` +
      `only the ${renderedSeriesCount.toLocaleString()} largest (by peak value) ` +
      `are drawn`
    : `All ${total.toLocaleString()} series were loaded${rowsDetail}, but only ` +
      `the ${renderedSeriesCount.toLocaleString()} largest (by peak value) are drawn`;
  const label =
    `Showing top ${renderedSeriesCount.toLocaleString()} of ` +
    `${total.toLocaleString()} series. ${completenessClause} to keep the chart ` +
    `readable — ${hiddenSeriesCount.toLocaleString()} smaller series are hidden. ` +
    (onLoadAll
      ? `Click to draw all ${total.toLocaleString()} (may be slow).`
      : 'Increase the series limit, or narrow the query with a stricter GROUP BY or WHERE filter, to see more.');

  const icon = (
    <IconAlertTriangle
      size={16}
      color="var(--color-text-warning)"
      data-testid="hidden-series-indicator-icon"
    />
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
