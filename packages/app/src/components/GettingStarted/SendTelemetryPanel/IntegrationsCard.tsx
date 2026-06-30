import { type IconType } from 'react-icons';
import { FaJsSquare } from 'react-icons/fa';
import { RiNextjsFill } from 'react-icons/ri';
import { SiDeno, SiGo, SiPython, SiRuby } from 'react-icons/si';
import { Box, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconArrowRight } from '@tabler/icons-react';

import { LogoBadge } from '@/components/LogoBadge/LogoBadge';

interface GridCell {
  key: string;
  Icon?: IconType;
  color?: string;
  size?: number;
}

/**
 * Checkerboard layout: brand logos on alternating cells, empty dashed tiles in
 * between to suggest there are many more integrations to plug in.
 */
const GRID_CELLS: GridCell[] = [
  { key: 'e1' },
  { key: 'js', Icon: FaJsSquare, color: '#f7df1e', size: 26 },
  { key: 'e2' },
  { key: 'python', Icon: SiPython, color: '#3776ab', size: 24 },
  { key: 'e3' },
  { key: 'go', Icon: SiGo, color: '#00add8', size: 28 },
  { key: 'ruby', Icon: SiRuby, color: '#cc342d', size: 22 },
  { key: 'e4' },
  { key: 'deno', Icon: SiDeno, color: 'var(--color-text)', size: 24 },
  { key: 'e5' },
  { key: 'nextjs', Icon: RiNextjsFill, color: 'var(--color-text)', size: 28 },
  { key: 'e6' },
];

function IntegrationsLogos() {
  return (
    <Box
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(6, auto)',
        gap: 12,
        justifyContent: 'end',
        flexShrink: 0,
      }}
    >
      {GRID_CELLS.map(({ key, Icon, color, size }) =>
        Icon ? (
          <LogoBadge key={key} size={50}>
            <Icon size={size} color={color} />
          </LogoBadge>
        ) : (
          <LogoBadge key={key} size={50} dashed />
        ),
      )}
    </Box>
  );
}

function OnboardingLink({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <UnstyledButton onClick={onClick}>
      <Group gap={5} align="center" wrap="nowrap">
        <Text
          fz={13}
          fw={500}
          style={{
            color: 'var(--click-global-color-text-link-default, #437eef)',
          }}
        >
          {label}
        </Text>
        <IconArrowRight
          size={13}
          style={{
            color: 'var(--click-global-color-text-link-default, #437eef)',
          }}
        />
      </Group>
    </UnstyledButton>
  );
}

export function IntegrationsCard({
  onBrowse,
  onLanguageSdks,
}: {
  onBrowse: () => void;
  onLanguageSdks: () => void;
}) {
  return (
    <Box
      style={{
        position: 'relative',
        overflow: 'hidden',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
      }}
    >
      <Group
        align="center"
        justify="space-between"
        wrap="nowrap"
        gap={28}
        py={16}
        pl={24}
        pr={8}
      >
        <Stack gap={10} style={{ width: 360, flexShrink: 0 }}>
          <Text fw={700} fz={16} style={{ color: 'var(--color-text)' }}>
            Enhance with integrations
          </Text>
          <Text fz={13} lh={1.45} style={{ color: 'var(--color-text-muted)' }}>
            Pull in logs, metrics, and traces from Kubernetes, Kafka, Postgres,
            Redis and 20+ more sources — or instrument your app with a
            ClickStack SDK.
          </Text>
          <Group gap={18}>
            <OnboardingLink
              label="Browse integration guides"
              onClick={onBrowse}
            />
            <OnboardingLink label="Language SDKs" onClick={onLanguageSdks} />
          </Group>
        </Stack>

        <IntegrationsLogos />
      </Group>
    </Box>
  );
}
