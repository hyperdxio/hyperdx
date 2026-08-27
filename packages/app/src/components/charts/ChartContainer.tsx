import { createContext, use } from 'react';
import { ActionIcon, Group, Menu, Stack, Tooltip } from '@mantine/core';
import { IconDotsVertical } from '@tabler/icons-react';

import styles from './ChartContainer.module.scss';

interface ChartContainerProps {
  title?: React.ReactNode;
  toolbarItems?: React.ReactNode[];
  children: React.ReactNode;
  disableReactiveContainer?: boolean;
}

// When true, ChartContainer renders a "card" style header: an inline header
// row with top padding so the title/toolbar don't hug the card edge. With a
// title it also draws a full-bleed separator; without a title it's a slim
// strip that right-aligns the toolbar (so it never overlaps content).
// Provided by dashboard tiles; other usages keep the plain, inline header.
const ChartContainerCardHeaderContext = createContext(false);

export function ChartContainerCardHeaderProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ChartContainerCardHeaderContext value={true}>
      {children}
    </ChartContainerCardHeaderContext>
  );
}

// Collapsed toolbar context for narrow dashboard tiles.
// `menuItems` contains pre-built Menu.Item elements (alert + kebab actions)
// that render as a flat list in the collapsed dropdown. `suffixCount` tells
// ChartContainer how many items at the end of toolbarItems[] are "suffix"
// (i.e. the hoverToolbar) and should be excluded from the inline row in the
// collapsed view — they are replaced by the flat menuItems instead.
interface CollapsedToolbarData {
  menuItems: React.ReactNode;
  suffixCount: number;
}

const CollapsedToolbarContext = createContext<CollapsedToolbarData | null>(
  null,
);

export function CollapsedToolbarProvider({
  menuItems,
  suffixCount,
  children,
}: CollapsedToolbarData & { children: React.ReactNode }) {
  return (
    <CollapsedToolbarContext value={{ menuItems, suffixCount }}>
      {children}
    </CollapsedToolbarContext>
  );
}

// Horizontal padding a dashboard tile applies to its content. The card header
// bleeds its separator to the tile edge by cancelling exactly this inset, so
// the tile must consume the same value (see DASHBOARD_TILE_PADDING_INLINE usage
// in DBDashboardPage) instead of a matching `.px-2` utility that could drift.
export const DASHBOARD_TILE_PADDING_INLINE =
  'calc(var(--mantine-spacing-md) * 0.5)';
const HEADER_SPACING = DASHBOARD_TILE_PADDING_INLINE;
const HEADER_SPACING_SLIM = 'calc(var(--mantine-spacing-md) * 0.25)';

// Reserve a consistent card-header height so tiles with a title-only header line
// up with tiles whose header carries controls (display switcher, indicators,
// kebab, etc.). Sized to the tallest of those controls — the DisplaySwitcher: an
// 18px `xs` ActionIcon inside a `py-2` (8px) group = 34px content, plus the
// header's slim vertical padding (spacing-md * 0.25 top and bottom = 8px) and the
// 1px bottom border, which count toward the box under `box-sizing: border-box` =
// 43px. The header centers its content, so shorter headers pad up to match
// instead of changing where the divider sits.
const CARD_HEADER_MIN_HEIGHT = 43;

function ChartContainer({
  title,
  toolbarItems,
  children,
  disableReactiveContainer,
}: ChartContainerProps) {
  const cardHeader = use(ChartContainerCardHeaderContext);
  const collapsedToolbar = use(CollapsedToolbarContext);
  const hasToolbar = !!toolbarItems?.length;
  const showHeader = !!title || hasToolbar;

  // In the collapsed view, split toolbarItems into inline items (indicators,
  // toggles) and suffix items (hoverToolbar) which get replaced by flat
  // Menu.Items from context. Filter out null/undefined entries (e.g.
  // filterWarning is null when no warning applies).
  const inlineItems = collapsedToolbar
    ? toolbarItems
        ?.slice(0, -collapsedToolbar.suffixCount || undefined)
        .filter(Boolean)
    : undefined;
  const hasInlineItems = !!inlineItems?.length;

  return (
    // Reset the context so nested ChartContainers don't inherit the card
    // header styling; only the top-most container under a tile gets it.
    <ChartContainerCardHeaderContext value={false}>
      <Stack
        h="100%"
        w="100%"
        gap={cardHeader ? 'xs' : undefined}
        style={{ flexGrow: 1 }}
        className={styles.root}
      >
        {showHeader && (
          <Group
            justify="space-between"
            align={cardHeader ? 'center' : 'start'}
            wrap="nowrap"
            style={
              cardHeader
                ? {
                    // Full-bleed: cancel the tile's horizontal padding
                    // (px-2 => spacing-md * 0.5) so the separator reaches the
                    // card edges, then re-inset the content.
                    marginInline: `calc(${HEADER_SPACING} * -1)`,
                    paddingInline: HEADER_SPACING,
                    // Keep the header strip compact: slim vertical padding for
                    // both titled and title-less tiles, plus a full-bleed
                    // separator so every tile has a consistent header.
                    paddingTop: HEADER_SPACING_SLIM,
                    paddingBottom: HEADER_SPACING_SLIM,
                    // Uniform header height whether or not the header has
                    // controls, so titles and dividers align across tiles.
                    minHeight: CARD_HEADER_MIN_HEIGHT,
                    borderBottom: '1px solid var(--color-border)',
                    // Keep the header pinned to the top of the card while the
                    // body scrolls. The scrollable body lives in its own region
                    // below (see the `disableReactiveContainer` branch), so the
                    // header must never shrink or scroll with it. `position:
                    // sticky` is a belt-and-suspenders fallback for the case
                    // where the card itself (rather than the body region) is the
                    // scroll container; it needs an opaque background matching
                    // the card and a z-index to sit above scrolled content.
                    flexShrink: 0,
                    position: 'sticky',
                    top: 0,
                    zIndex: 2,
                    background: 'var(--color-bg-body)',
                  }
                : undefined
            }
          >
            <span
              style={{
                flex: 1,
                flexShrink: 1,
                overflow: 'hidden',
                display: '-webkit-box',
                WebkitLineClamp: 4,
                WebkitBoxOrient: 'vertical',
                overflowWrap: 'break-word',
              }}
            >
              {title}
            </span>
            {toolbarItems && (
              <>
                {/* Normal toolbar: visible at wider sizes */}
                <Group
                  flex={0}
                  wrap="nowrap"
                  gap={5}
                  className={
                    collapsedToolbar ? styles.toolbarNormal : undefined
                  }
                >
                  {toolbarItems}
                </Group>
                {/* Collapsed toolbar: single ⋮ dropdown at narrow sizes.
                    Row 1 shows inline items (indicators, toggles) as-is,
                    then a divider, then flattened action Menu.Items. */}
                {collapsedToolbar && (
                  <div className={styles.toolbarCollapsed}>
                    <Menu width={220} position="bottom-end">
                      <Menu.Target>
                        <Tooltip label="Tile actions" position="top" withArrow>
                          <ActionIcon variant="subtle" size="sm">
                            <IconDotsVertical size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Menu.Target>
                      <Menu.Dropdown onMouseDown={e => e.stopPropagation()}>
                        {hasInlineItems && (
                          <div className={styles.inlineSection}>
                            <Group
                              gap="sm"
                              wrap="nowrap"
                              px="sm"
                              py="xs"
                              className={styles.inlineRow}
                            >
                              {inlineItems}
                            </Group>
                            <Menu.Divider />
                          </div>
                        )}
                        {collapsedToolbar.menuItems}
                      </Menu.Dropdown>
                    </Menu>
                  </div>
                )}
              </>
            )}
          </Group>
        )}
        {disableReactiveContainer ? (
          cardHeader ? (
            // In a card, the header row above is fixed (flexShrink: 0) and the
            // body owns the scroll. This keeps a sticky-style header genuinely
            // pinned for tall, normal-flow content (e.g. a long bar list) that
            // would otherwise scroll the whole card and drag the header away.
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              {children}
            </div>
          ) : (
            children
          )
        ) : (
          <div
            // Hack, recharts will release real fix soon https://github.com/recharts/recharts/issues/172
            style={{
              position: 'relative',
              width: '100%',
              height: '100%',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                top: 0,
              }}
            >
              {children}
            </div>
          </div>
        )}
      </Stack>
    </ChartContainerCardHeaderContext>
  );
}

export default ChartContainer;
