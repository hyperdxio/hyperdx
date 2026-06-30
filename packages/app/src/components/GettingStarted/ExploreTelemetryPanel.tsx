import { type ReactNode } from 'react';
import Link from 'next/link';
import { Anchor, Box, Group, Stack, Text } from '@mantine/core';
import {
  IconActivityHeartbeat,
  IconArrowRight,
  IconDatabase,
  IconHexagons,
  IconTable,
} from '@tabler/icons-react';

function CardChip({
  bg,
  color,
  children,
}: {
  bg: string;
  color: string;
  children: ReactNode;
}) {
  return (
    <Box
      style={{
        width: 36,
        height: 36,
        borderRadius: 8,
        background: bg,
        color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {children}
    </Box>
  );
}

function CardLink({ label, href }: { label: string; href: string }) {
  return (
    <Anchor component={Link} href={href} underline="never">
      <Group gap={4} align="center" wrap="nowrap">
        <Text fz={14} fw={500} style={{ color: 'var(--color-text-muted)' }}>
          {label}
        </Text>
        <IconArrowRight
          size={14}
          style={{ color: 'var(--color-text-muted)' }}
        />
      </Group>
    </Anchor>
  );
}

const EXPLORE_BARS = [
  40, 55, 48, 62, 58, 70, 65, 78, 72, 85, 80, 92, 88, 96, 90, 98,
];

function ExploreChartDecoration() {
  return (
    <Box
      aria-hidden
      style={{
        position: 'absolute',
        right: 0,
        top: 0,
        bottom: 0,
        width: '58%',
        opacity: 0.35,
        overflow: 'hidden',
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'flex-end',
        gap: 3,
        padding: '16px 16px 0',
        maskImage: 'linear-gradient(to right, transparent, #000 55%)',
        WebkitMaskImage: 'linear-gradient(to right, transparent, #000 55%)',
      }}
    >
      {EXPLORE_BARS.map(h => (
        <Box
          key={h}
          style={{
            flex: 1,
            height: `${h}%`,
            background: 'var(--mantine-color-blue-4)',
            borderRadius: '2px 2px 0 0',
          }}
        />
      ))}
    </Box>
  );
}

function ExploreCard() {
  return (
    <Box
      style={{
        position: 'relative',
        overflow: 'hidden',
        flex: 1,
        minWidth: 0,
        height: 148,
        border: '1px solid var(--color-border)',
        borderRadius: 4,
      }}
    >
      <ExploreChartDecoration />
      <Stack
        gap={10}
        style={{ position: 'relative', padding: 20, maxWidth: 320 }}
      >
        <Group gap={10} align="center" wrap="nowrap">
          <CardChip bg="var(--color-bg-muted)" color="var(--color-text-muted)">
            <IconTable size={20} />
          </CardChip>
          <Text fz={15} fw={500} style={{ color: 'var(--color-text)' }}>
            Search
          </Text>
        </Group>
        <Text fz={13} style={{ color: 'var(--color-text)' }}>
          Search and explore your logs and traces.
        </Text>
        <CardLink label="Explore" href="/search" />
      </Stack>
    </Box>
  );
}

function FeatureCard({
  chipBg,
  chipColor,
  icon,
  title,
  description,
  href,
}: {
  chipBg: string;
  chipColor: string;
  icon: ReactNode;
  title: string;
  description: string;
  href: string;
}) {
  return (
    <Anchor
      component={Link}
      href={href}
      underline="never"
      style={{ flex: 1, minWidth: 0 }}
    >
      <Stack
        gap={10}
        style={{
          height: '100%',
          border: '1px solid var(--color-border)',
          borderRadius: 4,
          padding: 21,
        }}
      >
        <Group gap={10} align="center" wrap="nowrap">
          <CardChip bg={chipBg} color={chipColor}>
            {icon}
          </CardChip>
          <Text fz={15} fw={500} style={{ color: 'var(--color-text)' }}>
            {title}
          </Text>
        </Group>
        <Text fz={13} lh={1.45} style={{ color: 'var(--color-text-muted)' }}>
          {description}
        </Text>
      </Stack>
    </Anchor>
  );
}

export function ExploreTelemetryPanel() {
  return (
    <Stack gap={16}>
      <ExploreCard />
      <Group gap={16} align="stretch" wrap="nowrap">
        <FeatureCard
          chipBg="var(--mantine-color-teal-light)"
          chipColor="var(--mantine-color-teal-light-color)"
          icon={<IconActivityHeartbeat size={20} />}
          title="Services"
          description="Monitor HTTP endpoints, latency, and error rates"
          href="/services"
        />
        <FeatureCard
          chipBg="rgba(238, 244, 0, 0.3)"
          chipColor="var(--color-text)"
          icon={<IconDatabase size={20} />}
          title="ClickHouse"
          description="ClickHouse cluster health and query performance"
          href="/clickhouse"
        />
        <FeatureCard
          chipBg="rgba(50, 109, 230, 0.12)"
          chipColor="#326de6"
          icon={<IconHexagons size={20} />}
          title="Kubernetes"
          description="Kubernetes cluster monitoring and pod health"
          href="/kubernetes"
        />
      </Group>
    </Stack>
  );
}

export default ExploreTelemetryPanel;
