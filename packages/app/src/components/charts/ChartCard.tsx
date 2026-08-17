import { Box } from '@mantine/core';

import {
  ChartContainerCardHeaderProvider,
  DASHBOARD_TILE_PADDING_INLINE,
} from './ChartContainer';

export interface ChartCardProps {
  children: React.ReactNode;
  /**
   * Sizing/overflow override merged over the card defaults. Kept as plain
   * `CSSProperties` (not Mantine's `MantineStyleProp`) because the defaults are
   * object-spread — a resolver function or style array would be silently
   * dropped. `paddingInline` is intentionally not honored here (see below).
   */
  style?: React.CSSProperties;
  'data-testid'?: string;
}

/**
 * Card wrapper that gives a chart the same look as a tile on a custom
 * dashboard: a bordered, rounded box whose chart header renders in "card mode"
 * (centered title row + a full-bleed bottom divider under the title).
 *
 * Not dashboard-specific — use it anywhere a chart should read as a card (search
 * page, service dashboards, the ClickHouse page, etc.).
 *
 * The header divider is only drawn when a descendant renders a `ChartContainer`
 * with a `title` or `toolbarItems` (e.g. `DBTimeChart`, `DBTableChart`); this
 * component just provides the context that switches that header into card mode.
 * Content with its own heading should render it through a titled
 * `ChartContainer` (rather than a bare `Text`) so it gets the same card header —
 * divider included — and the top padding the header supplies.
 *
 * This is the *visual* chrome only. The dashboard tile's toolbar controls
 * (fullscreen, line/bar display switcher, kebab menu) live on the tile itself
 * and are intentionally not included here.
 *
 * Keep the horizontal padding equal to DASHBOARD_TILE_PADDING_INLINE: the card
 * header's separator is drawn full-bleed by cancelling exactly this inset, so
 * any other value would leave the divider misaligned with the card edges. It is
 * re-applied after the caller `style` so an override can't silently break the
 * divider alignment.
 */
export function ChartCard({
  children,
  style,
  'data-testid': dataTestId,
}: ChartCardProps) {
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
        ...style,
        // Enforce the full-bleed divider invariant regardless of caller style.
        paddingInline: DASHBOARD_TILE_PADDING_INLINE,
      }}
    >
      <ChartContainerCardHeaderProvider>
        {children}
      </ChartContainerCardHeaderProvider>
    </Box>
  );
}
