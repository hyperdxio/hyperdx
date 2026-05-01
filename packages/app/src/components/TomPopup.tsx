import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Anchor, Box, Paper, Text, UnstyledButton } from '@mantine/core';

import {
  getReviewCopy,
  rateOptimizationLevel,
} from '@/optimizations/performanceReview';
import { useOptimizationOpportunities } from '@/optimizations/useOptimizations';
import { useSources } from '@/source';
import { useLocalStorage } from '@/utils';

const STORAGE_KEY = 'hdx.tomPopup.optimizationCountWhenLastDismissed';

const GRADE_PALETTE = {
  green: {
    fg: 'var(--mantine-color-green-light-color)',
    bg: 'var(--mantine-color-green-light)',
  },
  yellow: {
    fg: 'var(--mantine-color-yellow-light-color)',
    bg: 'var(--mantine-color-yellow-light)',
  },
  red: {
    fg: 'var(--mantine-color-red-light-color)',
    bg: 'var(--mantine-color-red-light)',
  },
} as const;

function TomHead({ size = 64 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Tom"
    >
      <ellipse
        cx="50"
        cy="56"
        rx="28"
        ry="32"
        fill="#f3c4a3"
        stroke="#3a2a20"
        strokeWidth="1.5"
      />
      <path
        d="M 22 36 Q 22 18 50 18 Q 78 18 78 36 L 78 40 L 22 40 Z"
        fill="#2e7d32"
        stroke="#1b5e20"
        strokeWidth="1.5"
      />
      <path
        d="M 50 40 Q 78 40 92 36 L 92 42 Q 78 46 50 46 Z"
        fill="#1b5e20"
        stroke="#1b5e20"
        strokeWidth="1"
      />
      <circle cx="50" cy="22" r="2" fill="#1b5e20" />
      <circle cx="40" cy="56" r="2" fill="#3a2a20" />
      <circle cx="60" cy="56" r="2" fill="#3a2a20" />
      <path
        d="M 43 71 Q 50 74 57 71"
        stroke="#3a2a20"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M 41 68 Q 45 66 50 67 Q 55 66 59 68 Q 55 70 50 70 Q 45 70 41 68 Z"
        fill="#9e9e9e"
      />
      <path
        d="M 42 76 Q 50 90 58 76 Q 55 84 50 84 Q 45 84 42 76 Z"
        fill="#9e9e9e"
        stroke="#616161"
        strokeWidth="0.5"
      />
    </svg>
  );
}

export function TomPopup() {
  const { totalActive, results } = useOptimizationOpportunities();
  const { data: sources } = useSources();

  const review = useMemo(
    () => rateOptimizationLevel(sources ?? [], results),
    [sources, results],
  );
  const copy = useMemo(() => getReviewCopy(review), [review]);
  const palette = GRADE_PALETTE[copy.color];

  const [dismissedCount, setDismissedCount] = useLocalStorage<number | null>(
    STORAGE_KEY,
    null,
  );
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissedCount(totalActive);
    setExpanded(false);
  };

  // Don't render when there are no active opportunities — Tom has nothing to
  // review. Stay hidden as long as the user has already dismissed at the
  // current (or higher) finding count; re-appears the next time a new finding
  // pushes the count past the dismissed snapshot.
  const isVisible =
    totalActive > 0 && (dismissedCount == null || totalActive > dismissedCount);

  if (!isVisible) return null;

  const headButton = (
    <UnstyledButton
      aria-label="Toggle Tom"
      onClick={() => setExpanded(v => !v)}
      w={64}
      h={64}
      p={0}
      style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.3))' }}
    >
      <TomHead size={64} />
    </UnstyledButton>
  );

  const dismissButton = (
    <UnstyledButton
      aria-label="Dismiss Tom"
      onClick={handleDismiss}
      pos="absolute"
      top={4}
      right={4}
      w={18}
      h={18}
      bg="white"
      c="dark"
      fz={12}
      lh="14px"
      ta="center"
      style={{
        borderRadius: '50%',
        border: '1px solid rgba(0,0,0,0.2)',
      }}
    >
      ×
    </UnstyledButton>
  );

  const activeBuckets = results.filter(r => r.activeFindings.length > 0);

  return (
    <Box pos="fixed" right={16} bottom={16}>
      {expanded ? (
        <Paper
          pos="relative"
          radius="md"
          shadow="md"
          p="md"
          maw={320}
          miw={240}
          bg="var(--color-bg-surface)"
          style={{
            pointerEvents: 'auto',
            borderLeft: `4px solid ${palette.fg}`,
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <Text size="xs" tt="uppercase" c="dimmed">
            Performance review · by Tom
          </Text>
          <Text fw={600} mb="xs">
            {copy.title}
          </Text>
          <Text fs="italic" mb={10} size="sm">
            &ldquo;{copy.body}&rdquo;
          </Text>
          {activeBuckets.length > 0 && (
            <Box mb="xs">
              <Text size="xs" fw={600} c="dimmed" mb={4} tt="uppercase">
                Action items
              </Text>
              <Box component="ul" m={0} pl={18}>
                {activeBuckets.map(({ plugin, activeFindings }) => (
                  <Box component="li" key={plugin.id} mb={2}>
                    {plugin.shortLabel}{' '}
                    <Text component="span" c="dimmed" size="xs">
                      ({activeFindings.length})
                    </Text>
                  </Box>
                ))}
              </Box>
            </Box>
          )}
          <Anchor
            component={Link}
            href="/team?tab=optimization#optimization"
            underline="always"
            style={{ color: palette.fg }}
            size="sm"
            onClick={() => setExpanded(false)}
          >
            See the full review →
          </Anchor>
          <Box pos="absolute" top={-24} right={-16}>
            {headButton}
            {dismissButton}
          </Box>
        </Paper>
      ) : (
        <Box
          pos="relative"
          style={{ pointerEvents: 'auto' }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {headButton}
          {(expanded || hovered) && dismissButton}
        </Box>
      )}
    </Box>
  );
}
