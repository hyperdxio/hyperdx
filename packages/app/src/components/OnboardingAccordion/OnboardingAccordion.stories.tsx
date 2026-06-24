import { type ReactNode, useState } from 'react';
import { type IconType } from 'react-icons';
import { FaJsSquare } from 'react-icons/fa';
import { RiNextjsFill } from 'react-icons/ri';
import { SiDeno, SiGo, SiPython, SiRuby } from 'react-icons/si';
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
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/nextjs';
import {
  IconActivityHeartbeat,
  IconAffiliate,
  IconArrowRight,
  IconCheck,
  IconCloud,
  IconCopy,
  IconDatabase,
  IconEye,
  IconEyeOff,
  IconGauge,
  IconHexagons,
  IconLogs,
  IconPencil,
  IconSparkles,
  IconTable,
} from '@tabler/icons-react';

import { LogoBadge } from '../LogoBadge/LogoBadge';

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
const API_KEY = 'hdx_sk_3f9ab2c7d41e8056';
const MASKED_KEY = '••••••••••••••••';

/** Violet accent used to brand the AI setup assistant (theme-agnostic). */
const AI_ACCENT = '#7c5cff';

const AI_AGENTS = [
  { label: 'Cursor', value: 'cursor' },
  { label: 'VS Code', value: 'vscode' },
  { label: 'Claude Code', value: 'claude' },
];

const SETUP_PROMPT = `Set up HyperDX / OpenTelemetry observability in this project.

Instrument the application to export logs, traces, and metrics over OTLP/HTTP to:
  endpoint: ${ENDPOINT}
  header:   authorization: ${API_KEY}

Add the OpenTelemetry SDK for this project's language/framework, wire up auto-instrumentation, generate any collector config that's needed, then run the app and confirm telemetry is arriving.`;

const CONNECTION_TABS = [
  { label: 'URL', value: 'url' },
  { label: 'Collector config', value: 'collector' },
  { label: 'Env vars', value: 'env' },
  {
    value: 'ai',
    label: (
      <Group gap={5} align="center" wrap="nowrap" style={{ color: AI_ACCENT }}>
        <IconSparkles size={13} />
        <span>AI agent</span>
      </Group>
    ),
  },
];

function connectionSnippet(tab: string, revealed: boolean) {
  const key = revealed ? API_KEY : MASKED_KEY;
  if (tab === 'collector') {
    return `exporters:
  otlphttp:
    endpoint: "${ENDPOINT}"
    headers:
      authorization: "${key}"`;
  }
  if (tab === 'env') {
    return `OTEL_EXPORTER_OTLP_ENDPOINT=${ENDPOINT}
OTEL_EXPORTER_OTLP_HEADERS=authorization=${key}`;
  }
  return `endpoint: ${ENDPOINT}
api-key:  ${key}`;
}

function ServiceLogo({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ color: 'var(--color-text)', display: 'block' }}
    >
      <path
        d="M15.1911 4.00991C16.9732 4.09669 18.6751 4.77664 20.0264 5.94168C21.3778 7.10673 22.3009 8.69002 22.6491 10.4399C22.8799 11.6006 22.8502 12.798 22.5624 13.9459C22.2745 15.0937 21.7356 16.1634 20.9844 17.0779C20.2333 17.9923 19.2886 18.7287 18.2185 19.234C17.1484 19.7393 15.9795 20.0009 14.7961 19.9999H6.7951C5.99749 19.9966 5.20907 19.8294 4.47882 19.5086C3.74857 19.1877 3.09209 18.7202 2.55015 18.135C2.00822 17.5497 1.5924 16.8593 1.32854 16.1066C1.06469 15.3539 0.958416 14.555 1.01634 13.7595C1.07426 12.964 1.29513 12.1889 1.66524 11.4823C2.03535 10.7758 2.54679 10.1529 3.16778 9.65229C3.78877 9.15173 4.50606 8.78421 5.27508 8.57255C6.0441 8.36089 6.84843 8.30961 7.6381 8.42191C8.50075 6.69965 9.95584 5.34646 11.7361 4.61091C12.8291 4.15717 14.0091 3.95157 15.1911 4.00891V4.00991ZM16.0711 5.57991C14.64 5.29599 13.155 5.49816 11.8519 6.15434C10.5488 6.81052 9.50217 7.88311 8.8781 9.20191C8.46451 10.0767 8.25003 11.0323 8.2501 11.9999C8.25373 12.0977 8.23759 12.1952 8.20267 12.2867C8.16774 12.3781 8.11474 12.4616 8.04682 12.532C7.97891 12.6025 7.89748 12.6586 7.80741 12.6969C7.71734 12.7352 7.62047 12.7549 7.5226 12.7549C7.42473 12.7549 7.32786 12.7352 7.23778 12.6969C7.14771 12.6586 7.06629 12.6025 6.99837 12.532C6.93046 12.4616 6.87746 12.3781 6.84253 12.2867C6.8076 12.1952 6.79147 12.0977 6.7951 11.9999C6.7951 11.2559 6.8951 10.5319 7.0951 9.82791L6.7951 9.81791C5.63769 9.81791 4.52769 10.2777 3.70928 11.0961C2.89088 11.9145 2.4311 13.0245 2.4311 14.1819C2.4311 15.3393 2.89088 16.4493 3.70928 17.2677C4.52769 18.0861 5.63769 18.5459 6.7951 18.5459H14.7951C16.0075 18.5451 17.1959 18.2077 18.2278 17.5713C19.2598 16.9349 20.0948 16.0245 20.6398 14.9415C21.1848 13.8585 21.4185 12.6454 21.3147 11.4375C21.2109 10.2295 20.7738 9.07409 20.0521 8.09991C19.084 6.79519 17.6655 5.897 16.0721 5.57991H16.0711ZM10.4101 13.0379C10.5454 13.0685 10.6661 13.1446 10.7522 13.2534C10.8383 13.3622 10.8845 13.4972 10.8831 13.6359V15.8759C10.8831 16.2159 10.6161 16.4879 10.2911 16.4879C9.9661 16.4879 9.7041 16.2109 9.7041 15.8719V13.6419C9.7041 13.3019 9.9661 13.0309 10.2911 13.0309L10.4101 13.0379ZM12.6471 8.72991C12.9721 8.72991 13.2341 9.00091 13.2341 9.33991V15.8719C13.2341 16.2119 12.9721 16.4879 12.6471 16.4879C12.4872 16.484 12.3354 16.417 12.2247 16.3016C12.114 16.1863 12.0534 16.0318 12.0561 15.8719V9.33991C12.0561 8.99991 12.3231 8.72991 12.6471 8.72991ZM15.1231 11.6079C15.258 11.6389 15.3782 11.7153 15.4634 11.8244C15.5486 11.9335 15.5937 12.0685 15.5911 12.2069V15.8769C15.5911 16.2159 15.3291 16.4879 15.0041 16.4879C14.8442 16.484 14.6924 16.417 14.5817 16.3016C14.471 16.1863 14.4104 16.0318 14.4131 15.8719V12.2069C14.4131 11.8669 14.6791 11.5949 15.0031 11.5899L15.1231 11.6079ZM17.4741 10.1719C17.6095 10.2031 17.7302 10.2796 17.8162 10.3887C17.9022 10.4978 17.9484 10.633 17.9471 10.7719V15.8769C17.9471 16.2159 17.6801 16.4879 17.3551 16.4879C17.0311 16.4879 16.7751 16.2109 16.7691 15.8719V10.7759C16.7691 10.4359 17.0311 10.1649 17.3551 10.1649L17.4751 10.1729L17.4741 10.1719Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ServiceSummaryBanner() {
  return (
    <Box
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        background: 'var(--color-bg-body)',
        padding: '12px 16px',
      }}
    >
      <Group justify="space-between" align="center" wrap="nowrap">
        <Group gap="sm" align="center" wrap="nowrap" style={{ minWidth: 0 }}>
          <LogoBadge size={32} radius={8}>
            <ServiceLogo size={20} />
          </LogoBadge>
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

/** A 6-column checkerboard of integration logos and empty "add more" tiles. */
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
            <OnboardingLink label="Browse integration guides" />
            <OnboardingLink label="Language SDKs" />
          </Group>
        </Stack>

        <IntegrationsLogos />
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

function ConnectionPanel() {
  const [tab, setTab] = useState('url');
  const [revealed, setRevealed] = useState(false);
  const isAi = tab === 'ai';
  const display = connectionSnippet(tab, revealed);
  const copyText = connectionSnippet(tab, true);

  return (
    <Box
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 10,
        overflow: 'hidden',
        background: 'var(--color-bg-surface)',
      }}
    >
      <Group
        justify="space-between"
        align="center"
        wrap="nowrap"
        px={10}
        py={8}
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <SegmentedControl
          size="xs"
          radius="md"
          value={tab}
          onChange={setTab}
          data={CONNECTION_TABS}
        />
        {isAi ? null : (
          <UnstyledButton onClick={() => setRevealed(r => !r)}>
            <Group gap={6} align="center" wrap="nowrap">
              {revealed ? (
                <IconEyeOff
                  size={15}
                  style={{ color: 'var(--color-text-muted)' }}
                />
              ) : (
                <IconEye
                  size={15}
                  style={{ color: 'var(--color-text-muted)' }}
                />
              )}
              <Text
                fz={12}
                fw={500}
                style={{ color: 'var(--color-text-muted)' }}
              >
                {revealed ? 'Hide key' : 'Reveal key'}
              </Text>
            </Group>
          </UnstyledButton>
        )}
      </Group>

      {isAi ? (
        <AIAgentTab />
      ) : (
        <Box
          style={{ position: 'relative', background: 'var(--color-bg-muted)' }}
        >
          <Box
            component="pre"
            style={{
              margin: 0,
              padding: '14px 52px 14px 16px',
              fontFamily:
                'var(--mantine-font-family-monospace, ui-monospace, monospace)',
              fontSize: 13,
              lineHeight: 1.65,
              color: 'var(--color-text)',
              whiteSpace: 'pre',
              overflowX: 'auto',
            }}
          >
            {display}
          </Box>
          <CopyButton value={copyText}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? 'Copied' : 'Copy'} withArrow>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  onClick={copy}
                  style={{ position: 'absolute', top: 8, right: 8 }}
                >
                  {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                </ActionIcon>
              </Tooltip>
            )}
          </CopyButton>
        </Box>
      )}
    </Box>
  );
}

function AIAgentTab() {
  const [agent, setAgent] = useState('cursor');
  const agentLabel =
    AI_AGENTS.find(a => a.value === agent)?.label ?? 'your agent';

  return (
    <Box
      style={{
        padding: 16,
        background: `color-mix(in srgb, ${AI_ACCENT} 6%, var(--color-bg-surface))`,
      }}
    >
      <Group gap={12} align="flex-start" wrap="nowrap">
        <Box
          style={{
            width: 36,
            height: 36,
            borderRadius: 9,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: AI_ACCENT,
            background: `color-mix(in srgb, ${AI_ACCENT} 16%, transparent)`,
          }}
        >
          <IconSparkles size={20} />
        </Box>
        <Stack gap={3} style={{ flex: 1, minWidth: 0 }}>
          <Text fw={600} fz={14} style={{ color: 'var(--color-text)' }}>
            Let your AI coding agent set it up
          </Text>
          <Text fz={13} lh={1.45} style={{ color: 'var(--color-text-muted)' }}>
            Copy a prompt for Cursor, VS Code, or Claude Code and let it
            instrument your app and configure the collector automatically.
          </Text>
        </Stack>
      </Group>

      <Group gap={8} wrap="nowrap" justify="space-between" mt={14}>
        <SegmentedControl
          size="xs"
          radius="md"
          value={agent}
          onChange={setAgent}
          data={AI_AGENTS}
        />
        <CopyButton value={SETUP_PROMPT}>
          {({ copied, copy }) => (
            <Button
              variant="primary"
              size="sm"
              onClick={copy}
              leftSection={
                copied ? <IconCheck size={15} /> : <IconCopy size={15} />
              }
            >
              {copied ? 'Prompt copied' : `Copy prompt for ${agentLabel}`}
            </Button>
          )}
        </CopyButton>
      </Group>
    </Box>
  );
}

function SendTelemetryBody() {
  return (
    <Stack gap={20}>
      <ConnectionPanel />

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
