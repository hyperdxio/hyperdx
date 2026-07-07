import { createContext, use } from 'react';
import { ActionIcon, Group, Popover, Stack, Tooltip } from '@mantine/core';
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

// Horizontal padding a dashboard tile applies to its content. The card header
// bleeds its separator to the tile edge by cancelling exactly this inset, so
// the tile must consume the same value (see DASHBOARD_TILE_PADDING_INLINE usage
// in DBDashboardPage) instead of a matching `.px-2` utility that could drift.
export const DASHBOARD_TILE_PADDING_INLINE =
  'calc(var(--mantine-spacing-md) * 0.5)';
const HEADER_SPACING = DASHBOARD_TILE_PADDING_INLINE;
const HEADER_SPACING_SLIM = 'calc(var(--mantine-spacing-md) * 0.25)';

function ChartContainer({
  title,
  toolbarItems,
  children,
  disableReactiveContainer,
}: ChartContainerProps) {
  const cardHeader = use(ChartContainerCardHeaderContext);
  const hasToolbar = !!toolbarItems?.length;
  const showHeader = !!title || hasToolbar;

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
                    borderBottom: '1px solid var(--color-border)',
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
                  className={styles.toolbarNormal}
                >
                  {toolbarItems}
                </Group>
                {/* Collapsed toolbar: single ⋮ icon at narrow sizes */}
                <div className={styles.toolbarCollapsed}>
                  <Popover width={200} position="bottom-end">
                    <Popover.Target>
                      <Tooltip
                        label="Tile actions"
                        position="top"
                        withArrow
                      >
                        <ActionIcon variant="subtle" size="sm">
                          <IconDotsVertical size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Popover.Target>
                    <Popover.Dropdown
                      onMouseDown={e => e.stopPropagation()}
                    >
                      <Group gap={5} justify="center">
                        {toolbarItems}
                      </Group>
                    </Popover.Dropdown>
                  </Popover>
                </div>
              </>
            )}
          </Group>
        )}
        {disableReactiveContainer ? (
          children
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
