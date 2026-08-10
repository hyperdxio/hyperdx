import { ActionIcon, Tooltip } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';

interface HiddenSeriesIndicatorProps {
  hiddenSeriesCount: number;
  renderedSeriesCount: number;
  /**
   * Total rows returned by the query — shown alongside the series counts so the
   * user can see both dimensions (rows vs series). Omit if unknown.
   */
  rowCount?: number;
  /**
   * True when the underlying query hit the server-side row cap (see
   * ResultOverflowBanner). When set, this notice must NOT claim "all series were
   * loaded" — the result is a capped subset, so the series counts describe only
   * what came back, not the full cardinality. Prevents the two banners from
   * making contradictory completeness claims on the same tile.
   */
  resultWasCapped?: boolean;
  /** Render every series, bypassing the cap. Omit to keep the notice passive. */
  onLoadAll?: () => void;
}

/**
 * Client-side SERIES cap notice. The loaded result draws only the top-N series
 * (by peak value) to keep the page responsive — this surfaces how many were
 * hidden and, when `onLoadAll` is provided, lets the user draw all of them
 * anyway. Normally the RECOVERABLE case: all fetched data is present, it's just
 * not all drawn. Contrast ResultOverflowBanner, which reports that the query may
 * not have fetched everything (row cap). When `resultWasCapped` is true both
 * conditions hold at once, so the copy drops the "all series were loaded" claim
 * to avoid contradicting the overflow banner. Copy deliberately uses "drawn"
 * here vs the row-cap banner's "missing data" so the two stay distinct.
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
  // Row count is secondary detail (series is the primary unit for this notice).
  const rowsDetail =
    typeof rowCount === 'number'
      ? ` (from ${rowCount.toLocaleString()} rows)`
      : '';
  // When the result was capped, the loaded data is already a subset — don't
  // claim "all series were loaded" (that's the overflow banner's job to
  // qualify). Otherwise state completeness so the recoverable case is clear.
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
