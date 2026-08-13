import { Alert, Text, Tooltip } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';

interface ResultOverflowBannerProps {
  /** Whether the query hit the row cap. When false, nothing renders. */
  didOverflow: boolean | undefined;
  /** The row cap that was applied, shown in the message. */
  cap: number;
  /** Rows returned by the capped query (≈cap since the cap is block-aligned). */
  rows?: number;
  /** Distinct series (groups) in the capped result. Omit if unknown. */
  series?: number;
}

/**
 * Row-cap banner shown below a chart's header when the tile's query hit the cap
 * (see DEFAULT_MAX_TILE_RESULT_ROWS). Detection is `rows > cap`, which can't
 * prove rows were dropped, so the copy says the chart *may be* missing data.
 * Contrast HiddenSeriesIndicator (limits only how many series are drawn).
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

  // Approximate (block-aligned cap), so prefix with "~".
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
          wrapper: { alignItems: 'center' },
          body: { minWidth: 0 },
          message: { margin: 0 },
          icon: { marginRight: 8, width: 14, height: 14 },
        }}
        // Stop propagation so a click doesn't start a react-grid-layout drag.
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
