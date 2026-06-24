import { type ReactNode, useState } from 'react';
import {
  ActionIcon,
  Anchor,
  Box,
  Button,
  CopyButton,
  Group,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/nextjs';
import {
  IconActivityHeartbeat,
  IconAffiliate,
  IconArrowRight,
  IconBrandDocker,
  IconBrandGolang,
  IconBrandJavascript,
  IconBrandPython,
  IconBrandTypescript,
  IconCheck,
  IconCloud,
  IconCopy,
  IconDatabase,
  IconGauge,
  IconHexagons,
  IconKey,
  IconLogs,
  IconPencil,
  IconTable,
} from '@tabler/icons-react';

import {
  OnboardingAccordion,
  type OnboardingStep,
} from './OnboardingAccordion';

const meta: Meta<typeof OnboardingAccordion> = {
  title: 'Components/OnboardingAccordion',
  component: OnboardingAccordion,
  parameters: { layout: 'padded' },
  decorators: [
    Story => (
      <Box maw={880} mx="auto" py="xl">
        <Story />
      </Box>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof OnboardingAccordion>;

const ENDPOINT = 'https://vpgy734q1n.otel.us-east-1.aws.clickhouse.cloud:4318';

function ServiceSummaryBanner() {
  return (
    <Box
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        background: 'var(--color-bg-muted)',
        padding: '12px 16px',
      }}
    >
      <Group justify="space-between" align="center" wrap="nowrap">
        <Group gap="sm" align="center" wrap="nowrap" style={{ minWidth: 0 }}>
          <Box
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,

              border: '1px solid var(--color-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <IconCloud size={16} style={{ color: 'var(--color-text-muted)' }} />
          </Box>
          <Group gap={14} align="center" wrap="nowrap" style={{ minWidth: 0 }}>
            <Group gap={6} align="center" wrap="nowrap">
              <Text fw={700} fz={14} style={{ color: 'var(--color-text)' }}>
                Elizabet service
              </Text>
              <IconPencil
                size={12}
                style={{ color: 'var(--color-text-muted)' }}
              />
            </Group>
            <Text fz={13} style={{ color: 'var(--color-text-muted)' }}>
              AWS (us-east-1)
            </Text>
            <Group gap="md" wrap="nowrap">
              <StatusDot label="Storage" />
              <StatusDot label="OpenTelemetry Collector" />
            </Group>
          </Group>
        </Group>
        <Text
          fz={12}
          style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}
        >
          updated 2s ago
        </Text>
      </Group>
    </Box>
  );
}

function StatusDot({ label }: { label: string }) {
  return (
    <Group gap={6} align="center">
      <Text fz={13} style={{ color: 'var(--color-text)' }}>
        {label}
      </Text>
      <Box
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: 'var(--color-text-success, #16a34a)',
        }}
      />
    </Group>
  );
}

const INTEGRATIONS = [
  { Icon: IconBrandJavascript, color: '#f7df1e', top: 8, left: 24 },
  { Icon: IconBrandPython, color: '#3776ab', top: 78, left: 150 },
  { Icon: IconBrandTypescript, color: '#3178c6', top: 28, left: 96 },
  { Icon: IconBrandGolang, color: '#00add8', top: 86, left: 32 },
  { Icon: IconBrandDocker, color: '#2496ed', top: 6, left: 178 },
];

function IntegrationsCard() {
  return (
    <Box
      style={{
        position: 'relative',
        overflow: 'hidden',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
      }}
    >
      <Group align="center" wrap="nowrap" gap={28} py={16} pl={24} pr={8}>
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
            <OnboardingLink label="Browse integration guides" />
            <OnboardingLink label="Language SDKs" />
          </Group>
        </Stack>

        <Box
          style={{
            position: 'relative',
            width: 250,
            height: 168,
            flexShrink: 0,
            backgroundImage:
              'radial-gradient(var(--color-border) 1px, transparent 1px)',
            backgroundSize: '25px 25px',
            borderRadius: 8,
            alignSelf: 'stretch',
          }}
        >
          {INTEGRATIONS.map(({ Icon, color, top, left }) => (
            <Box
              key={`${top}-${left}`}
              style={{
                position: 'absolute',
                top,
                left,
                width: 48,
                height: 48,
                borderRadius: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow:
                  '0 0 0 1px rgba(9,9,11,0.08), 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)',
              }}
            >
              <Icon size={24} color={color} />
            </Box>
          ))}
        </Box>
      </Group>
    </Box>
  );
}

function OnboardingLink({ label }: { label: string }) {
  return (
    <Anchor href="#" underline="never" onClick={e => e.preventDefault()}>
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
    </Anchor>
  );
}

function SendTelemetryBody() {
  const [tab, setTab] = useState('url');

  return (
    <Stack gap={22}>
      <Stack gap={16}>
        <SegmentedControl
          fullWidth
          value={tab}
          onChange={setTab}
          data={[
            { label: 'URL', value: 'url' },
            { label: 'Collector config', value: 'collector' },
            { label: 'Env vars', value: 'env' },
          ]}
        />
        <Group gap={8} wrap="nowrap" align="center">
          <TextInput
            readOnly
            flex={1}
            value={ENDPOINT}
            styles={{ input: { fontSize: 13 } }}
            rightSection={
              <CopyButton value={ENDPOINT}>
                {({ copied, copy }) => (
                  <Tooltip label={copied ? 'Copied' : 'Copy'} withArrow>
                    <ActionIcon variant="subtle" color="gray" onClick={copy}>
                      {copied ? (
                        <IconCheck size={16} />
                      ) : (
                        <IconCopy size={16} />
                      )}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            }
          />
          <Tooltip label="View API key" withArrow>
            <ActionIcon
              size={36}
              radius={4}
              style={{
                background: 'var(--palette-slate-800, #302e32)',
                color: '#ffffff',
              }}
            >
              <IconKey size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Stack>

      <Box style={{ height: 1, background: 'var(--color-border)' }} />

      <IntegrationsCard />

      <Group gap={12} align="center">
        <Button variant="secondary" size="xs">
          Check for telemetry
        </Button>
        <Text fz={12} style={{ color: 'var(--color-text-muted)' }}>
          Once data is detected your next cards will be ready to use
        </Text>
      </Group>
    </Stack>
  );
}

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

function MutedLink({ label }: { label: string }) {
  return (
    <Anchor href="#" underline="never" onClick={e => e.preventDefault()}>
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

function TelemetryPill({
  icon,
  label,
  active = false,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
}) {
  const fg = active
    ? 'var(--mantine-color-green-light-color)'
    : 'var(--color-text-muted)';
  return (
    <Group
      gap={6}
      align="center"
      wrap="nowrap"
      style={{
        padding: '3px 10px 3px 8px',
        borderRadius: 1000,
        background: active
          ? 'var(--mantine-color-green-light)'
          : 'var(--color-bg-muted)',
      }}
    >
      <Box style={{ display: 'flex', color: fg }}>{icon}</Box>
      <Text fz={14} fw={500} style={{ color: fg }}>
        {label}
      </Text>
      <Box
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: active
            ? 'var(--color-text-success, #16a34a)'
            : 'var(--mantine-color-gray-4)',
        }}
      />
    </Group>
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
            Explore
          </Text>
        </Group>
        <Text fz={13} style={{ color: 'var(--color-text)' }}>
          Explore logs, traces.
        </Text>
        <MutedLink label="Explore" />
      </Stack>
    </Box>
  );
}

function DataSourcesCard() {
  return (
    <Stack
      gap={12}
      style={{
        width: 392,
        flexShrink: 0,
        border: '1px solid var(--color-border)',
        borderRadius: 4,

        padding: 21,
      }}
    >
      <Group gap={10} align="center" wrap="nowrap">
        <CardChip bg="var(--color-bg-muted)" color="var(--color-text-muted)">
          <IconCloud size={20} />
        </CardChip>
        <Text fz={15} fw={500} style={{ color: 'var(--color-text)' }}>
          Data sources
        </Text>
      </Group>
      <Group gap={10} wrap="nowrap">
        <TelemetryPill active icon={<IconLogs size={14} />} label="Logs" />
        <TelemetryPill
          active
          icon={<IconAffiliate size={14} />}
          label="Traces"
        />
        <TelemetryPill icon={<IconGauge size={14} />} label="Metrics" />
      </Group>
      <MutedLink label="Edit your data sources" />
    </Stack>
  );
}

function FeatureCard({
  chipBg,
  chipColor,
  icon,
  title,
  description,
}: {
  chipBg: string;
  chipColor: string;
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Stack
      gap={10}
      style={{
        flex: 1,
        minWidth: 0,
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
  );
}

function ExploreTelemetryBody() {
  return (
    <Stack gap={16}>
      <Group gap={16} align="stretch" wrap="nowrap">
        <ExploreCard />
        <DataSourcesCard />
      </Group>
      <Group gap={16} align="stretch" wrap="nowrap">
        <FeatureCard
          chipBg="var(--mantine-color-teal-light)"
          chipColor="var(--mantine-color-teal-light-color)"
          icon={<IconActivityHeartbeat size={20} />}
          title="Services"
          description="Monitor HTTP endpoints, latency, and error rates"
        />
        <FeatureCard
          chipBg="rgba(238, 244, 0, 0.3)"
          chipColor="var(--color-text)"
          icon={<IconDatabase size={20} />}
          title="ClickHouse"
          description="ClickHouse cluster health and query performance"
        />
        <FeatureCard
          chipBg="rgba(50, 109, 230, 0.12)"
          chipColor="#326de6"
          icon={<IconHexagons size={20} />}
          title="Kubernetes"
          description="Kubernetes cluster monitoring and pod health"
        />
      </Group>
    </Stack>
  );
}

const STEPS: OnboardingStep[] = [
  {
    id: 'send-telemetry',
    title: 'Send telemetry',
    status: 'active',
    description: 'Point your OpenTelemetry collector or SDK at this endpoint',
    children: <SendTelemetryBody />,
  },
  {
    id: 'explore-telemetry',
    title: 'Explore your telemetry',
    status: 'upcoming',
    description:
      'Search, visualize, and dashboard your logs, traces, and metrics — or jump into a prebuilt view to start investigating.',
    children: <ExploreTelemetryBody />,
  },
];

const HEADER_DESCRIPTION = (
  <>
    We run everything — you just send your data. Rather manage it all yourself?{' '}
    <Anchor href="#" underline="never" onClick={e => e.preventDefault()}>
      <Text
        span
        fz={14}
        fw={500}
        style={{
          color: 'var(--click-global-color-text-link-default, #437eef)',
        }}
      >
        Go self-managed →
      </Text>
    </Anchor>
  </>
);

export const Default: Story = {
  args: {
    title: 'Start sending telemetry',
    description: HEADER_DESCRIPTION,
    banner: <ServiceSummaryBanner />,
    steps: STEPS,
    defaultOpenStep: 'send-telemetry',
  },
};

export const ExploreExpanded: Story = {
  args: {
    title: 'Start sending telemetry',
    description: HEADER_DESCRIPTION,
    banner: <ServiceSummaryBanner />,
    steps: STEPS,
    defaultOpenStep: 'explore-telemetry',
  },
};

export const AllStepsCollapsed: Story = {
  args: {
    title: 'Start sending telemetry',
    description: HEADER_DESCRIPTION,
    banner: <ServiceSummaryBanner />,
    steps: STEPS,
  },
};
