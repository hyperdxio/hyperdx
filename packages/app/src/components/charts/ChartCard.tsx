import { Box, BoxComponentProps } from '@mantine/core';

import {
  ChartContainerCardHeaderProvider,
  DASHBOARD_TILE_PADDING_INLINE,
} from './ChartContainer';

/**
 * Card wrapper that gives a chart the same look as a tile on a custom
 * dashboard: a bordered, rounded box whose chart header renders in "card mode"
 * (centered title row + a full-bleed bottom divider under the title).
 *
 * Not dashboard-specific — use it anywhere a chart should read as a card (search
 * page, service dashboards, the ClickHouse page, etc.). It replaces the older
 * plain `ChartBox` so these surfaces share one consistent card treatment.
 *
 * This is the *visual* chrome only. The dashboard tile's toolbar controls
 * (fullscreen, line/bar display switcher, kebab menu) live on the tile itself
 * and are intentionally not included here.
 *
 * Keep the horizontal padding equal to DASHBOARD_TILE_PADDING_INLINE: the card
 * header's separator is drawn full-bleed by cancelling exactly this inset, so
 * any other value would leave the divider misaligned with the card edges.
 */
export function ChartCard({
  children,
  style,
  'data-testid': dataTestId,
}: {
  children: React.ReactNode;
  style?: BoxComponentProps['style'];
  'data-testid'?: string;
}) {
  return (
    <Box
      data-testid={dataTestId}
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--color-bg-body)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--mantine-radius-sm)',
        // Match the dashboard tile: no top padding (the card header supplies its
        // own), slim bottom padding, and horizontal padding pinned to the tile
        // inset so the header divider bleeds to the card edges.
        paddingTop: 0,
        paddingBottom: 'var(--mantine-spacing-xs)',
        paddingInline: DASHBOARD_TILE_PADDING_INLINE,
        ...style,
      }}
    >
      <ChartContainerCardHeaderProvider>
        {children}
      </ChartContainerCardHeaderProvider>
    </Box>
  );
}
