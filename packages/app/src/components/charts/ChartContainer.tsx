import { createContext, use } from 'react';
import { Group, Stack } from '@mantine/core';

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

const HEADER_SPACING = 'calc(var(--mantine-spacing-md) * 0.5)';
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
              }}
            >
              {title}
            </span>
            {toolbarItems && (
              <Group flex={0} wrap="nowrap" gap={5}>
                {toolbarItems}
              </Group>
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
