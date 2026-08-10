import { Alert, Text, Tooltip } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';

interface ResultOverflowBannerProps {
  /** Whether the query hit the row cap. When false, nothing renders. */
  didOverflow: boolean | undefined;
  /** The row cap that was applied, shown in the message. */
  cap: number;
  /**
   * Rows actually returned by the (capped) query — shown so the user sees the
   * concrete size. Because the cap is block-aligned this is ~cap, not the true
   * uncapped total. Omit if unknown.
   */
  rows?: number;
  /**
   * Distinct series (groups) present in the capped result — shown alongside
   * rows so this banner is directly comparable to the hidden-series indicator.
   * Omit if unknown.
   */
  series?: number;
}

/**
 * Server-side ROW cap banner, rendered just below a chart's header (via
 * ChartContainer's `belowHeader` slot) when the tile's query hit the row /
 * group-by cap (see DEFAULT_MAX_TILE_RESULT_ROWS). Because detection is based on
 * the returned row count alone (`rows > cap`), it cannot prove the server
 * actually dropped rows — a block-aligned break or a non-aggregating query can
 * legitimately return a complete result that merely exceeds the cap. So the copy
 * says the chart *may be missing data* rather than asserting truncation. The fix
 * is always the same: narrow the query. Contrast HiddenSeriesIndicator, which
 * loads the full result and only limits how many series are *drawn* (recoverable
 * via "load all"); this banner is about data the query may not have fetched at
 * all. Kept to one small line so it doesn't crowd the chart; the full guidance
 * lives in the tooltip.
 */
export default function ResultOverflowBanner({
  didOverflow,
  cap,
  rows,
  series,
}: ResultOverflowBannerProps) {
  if (!didOverflow) {
    return null;
  }

  // Rows is the primary unit for this banner; prefer the concrete returned-row
  // count, fall back to the cap. Both are approximate (the cap is block-aligned),
  // so always prefix with "~". Series is secondary detail.
  const rowsShown = (rows ?? cap).toLocaleString();
  const seriesText =
    typeof series === 'number' ? ` (~${series.toLocaleString()} series)` : '';

  return (
    <Tooltip
      multiline
      maw={360}
      label={
        `This query hit the ~${rowsShown}-row cap${seriesText}, so the chart ` +
        `may be missing data — the server stops fetching once the cap is ` +
        `reached. Narrow it with a stricter GROUP BY, a WHERE filter, a shorter ` +
        `time range, or a lower-cardinality query.`
      }
    >
      <Alert
        variant="warning"
        icon={<IconAlertTriangle size={14} />}
        py={4}
        px="xs"
        styles={{
          // Keep the alert to a single tight line regardless of the tile body's
          // fs-7 / monospace context; the chart gets the remaining height.
          wrapper: { alignItems: 'center' },
          body: { minWidth: 0 },
          message: { margin: 0 },
          icon: { marginRight: 8, width: 14, height: 14 },
        }}
        // Sits inside react-grid-layout's drag subtree; stop propagation so a
        // click on the banner doesn't start a tile drag.
        onMouseDown={e => e.stopPropagation()}
      >
        <Text
          size="xs"
          fw={500}
          truncate
          style={{ fontFamily: 'var(--mantine-font-family)' }}
        >
          Hit the ~{rowsShown}-row cap{seriesText} — chart may be missing data.
        </Text>
      </Alert>
    </Tooltip>
  );
}
