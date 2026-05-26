import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, ScrollArea, Stack, Text, UnstyledButton } from '@mantine/core';
import { useScrollSpy } from '@mantine/hooks';

type TOCContainer = { id: string; title: string };

type DashboardTOCProps = {
  containers: TOCContainer[];
  onJump: (containerId: string) => void;
};

/**
 * In-flow table-of-contents rail listing dashboard sections (containers) for
 * quick navigation. Designed to be mounted inside a sticky sidebar slot in
 * `DBDashboardPage` so it sits next to the dashboard content rather than
 * overlaying it.
 *
 * Uses Mantine's `useScrollSpy` to highlight the section currently closest to
 * the top of the viewport. Mounted only when the user has opted in via the
 * "Show table of contents" view-option, so this UI is invisible by default.
 */
export function DashboardTOC({ containers, onJump }: DashboardTOCProps) {
  // The app layout puts page content inside #app-content-scroll-container,
  // which is what actually scrolls (the window does not). useScrollSpy
  // defaults to listening on `window`, so without this it never sees the
  // scroll events the dashboard generates and `active` stays at 0 forever.
  // Resolve the element after mount because it doesn't exist during SSR.
  const [scrollHost, setScrollHost] = useState<HTMLElement | undefined>(
    undefined,
  );
  useEffect(() => {
    const el = document.getElementById('app-content-scroll-container');
    if (el) setScrollHost(el);
  }, []);

  const { active, reinitialize } = useScrollSpy({
    selector: '[id^="container-"]',
    getDepth: () => 1,
    getValue: el => el.id,
    scrollHost,
  });

  // `useScrollSpy` walks the DOM once at mount. Re-scan whenever the set of
  // containers changes so renames / additions / removals don't leave us
  // pointing at a stale index.
  //
  // `reinitialize` is deliberately NOT in the dep array: in Mantine v9 its
  // identity changes every render. If it's a dep, the effect re-fires each
  // render → reinitialize schedules a state update inside useScrollSpy →
  // component re-renders → reinitialize has a new identity → effect fires
  // again — infinite loop, "Maximum update depth exceeded", and React
  // never reaches the post-hydration commit that would populate
  // `router.query.dashboardId` on the dashboard page (manifesting as a
  // stuck "Temporary Dashboard" banner on saved-dashboard URLs).
  const containerSignature = containers.map(c => c.id).join('|');
  useEffect(() => {
    reinitialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerSignature]);

  // Click-overrides-spy. The spy reports the section whose top is closest to
  // the viewport top — which is what you want most of the time, but it has a
  // common dead zone: when the user clicks a section that is already visible
  // but cannot be scroll-pinned at the top (e.g. the last section in a
  // dashboard short enough that the bottom hits the scroll end before the
  // section's top reaches the viewport top), the spy never updates and the
  // highlight stays on whatever was previously active. Treating a click as
  // explicit user intent fixes the dead zone: we override the spy's `active`
  // with the clicked entry, then hand control back to the spy when the user
  // next scrolls manually.
  const [clickedId, setClickedId] = useState<string | null>(null);
  const clickArmTimerRef = useRef<number | null>(null);

  const handleEntryClick = useCallback(
    (id: string) => {
      setClickedId(id);
      onJump(id);
    },
    [onJump],
  );

  // When a click override is set, wait long enough for the smooth scroll
  // triggered by the click to settle (~700ms), then arm a one-time scroll
  // listener that clears the override on the next user-initiated scroll.
  useEffect(() => {
    if (clickedId === null) return;
    const host = scrollHost ?? window;
    let cleanup: (() => void) | null = null;
    clickArmTimerRef.current = window.setTimeout(() => {
      const clear = () => setClickedId(null);
      host.addEventListener('scroll', clear, { once: true });
      cleanup = () => host.removeEventListener('scroll', clear);
      clickArmTimerRef.current = null;
    }, 700);
    return () => {
      if (clickArmTimerRef.current !== null) {
        window.clearTimeout(clickArmTimerRef.current);
        clickArmTimerRef.current = null;
      }
      if (cleanup) cleanup();
    };
  }, [clickedId, scrollHost]);

  const clickedIndex = clickedId
    ? containers.findIndex(c => c.id === clickedId)
    : -1;
  const activeIndex = clickedIndex >= 0 ? clickedIndex : active;

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
          {containers.map((c, i) => {
            const isActive = i === activeIndex;
            return (
              <UnstyledButton
                key={c.id}
                onClick={() => handleEntryClick(c.id)}
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
