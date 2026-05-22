import { useEffect } from 'react';
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
  const { active, reinitialize } = useScrollSpy({
    selector: '[id^="container-"]',
    getDepth: () => 1,
    getValue: el => el.id,
  });

  // `useScrollSpy` walks the DOM once at mount. Re-scan whenever the set of
  // containers changes so renames / additions / removals don't leave us
  // pointing at a stale index.
  const containerSignature = containers.map(c => c.id).join('|');
  useEffect(() => {
    reinitialize();
  }, [containerSignature, reinitialize]);

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
            const isActive = i === active;
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
