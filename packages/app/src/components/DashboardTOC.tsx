import { useEffect, useState } from 'react';
import { Box, ScrollArea, Stack, Text, UnstyledButton } from '@mantine/core';

type TOCContainer = { id: string; title: string };

type DashboardTOCProps = {
  containers: TOCContainer[];
  onJump: (containerId: string) => void;
};

const SCROLL_HOST_ID = 'app-content-scroll-container';
const CONTAINER_ID_PREFIX = 'container-';

/**
 * In-flow table-of-contents rail listing dashboard sections (containers).
 *
 * The active highlight follows whichever section has the highest viewport
 * visibility — computed via an `IntersectionObserver` rooted at the actual
 * scroll container (the app layout puts page content inside #app-content-
 * scroll-container; the window does not scroll). That rule is what users
 * naturally expect ("highlight what I'm looking at") and it handles two
 * cases that the more common "closest-to-viewport-top" heuristic fails on:
 *
 *  - Clicking a section that already fits in the viewport but cannot be
 *    scroll-pinned to the top (e.g. the last section when the dashboard's
 *    bottom hits the scroll end first). After `scrollIntoView` settles
 *    that section IS the most-visible one, so it ends up highlighted.
 *  - Sections smaller than the viewport: whichever one occupies the most
 *    pixels wins, which matches what the user sees.
 */
export function DashboardTOC({ containers, onJump }: DashboardTOCProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  // Containers' identity is used as the effect's dep. We also depend on the
  // referenced id strings, not the array reference, so a parent re-render
  // that produces a new array but the same ids doesn't churn the observer.
  const containersKey = containers.map(c => c.id).join('|');

  useEffect(() => {
    if (containers.length === 0) return;

    const root = document.getElementById(SCROLL_HOST_ID);
    const visibility = new Map<string, number>();

    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          const id = entry.target.id.slice(CONTAINER_ID_PREFIX.length);
          visibility.set(id, entry.intersectionRatio);
        }
        let bestId: string | null = null;
        let bestRatio = -1;
        for (const [id, ratio] of visibility) {
          if (ratio > bestRatio) {
            bestId = id;
            bestRatio = ratio;
          }
        }
        setActiveId(bestId);
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );

    for (const c of containers) {
      const el = document.getElementById(`${CONTAINER_ID_PREFIX}${c.id}`);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
    // `containers` itself is fine to omit — `containersKey` captures the
    // identity we care about and lets the effect re-run when the id list
    // changes without churning on unrelated parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containersKey]);

  if (containers.length === 0) return null;

  return (
    <Box data-testid="dashboard-toc" w="100%">
      <Text
        size="xs"
        fw={600}
        c="dimmed"
        tt="uppercase"
        mb={6}
        ml={10}
        style={{ letterSpacing: '0.04em' }}
      >
        Sections
      </Text>
      <ScrollArea.Autosize mah="calc(100vh - 160px)" type="hover">
        <Stack gap={0}>
          {containers.map(c => {
            const isActive = c.id === activeId;
            return (
              <UnstyledButton
                key={c.id}
                onClick={() => onJump(c.id)}
                data-testid={`toc-entry-${c.id}`}
                data-active={isActive || undefined}
                style={{
                  display: 'block',
                  padding: '4px 10px',
                  fontSize: 'var(--mantine-font-size-xs)',
                  lineHeight: 1.5,
                  color: isActive
                    ? 'var(--mantine-color-text)'
                    : 'var(--mantine-color-dimmed)',
                  borderLeft: `2px solid ${
                    isActive
                      ? 'var(--mantine-primary-color-filled)'
                      : 'var(--mantine-color-default-border)'
                  }`,
                  transition:
                    'color 100ms ease, border-color 100ms ease, background-color 100ms ease',
                  textAlign: 'left',
                  width: '100%',
                  borderRadius: 0,
                }}
                onMouseEnter={e => {
                  if (!isActive) {
                    e.currentTarget.style.color = 'var(--mantine-color-text)';
                  }
                }}
                onMouseLeave={e => {
                  if (!isActive) {
                    e.currentTarget.style.color = 'var(--mantine-color-dimmed)';
                  }
                }}
              >
                {c.title || '(untitled)'}
              </UnstyledButton>
            );
          })}
        </Stack>
      </ScrollArea.Autosize>
    </Box>
  );
}
