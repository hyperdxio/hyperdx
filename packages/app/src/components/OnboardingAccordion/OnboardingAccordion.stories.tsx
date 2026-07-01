import { type ReactNode, useEffect, useState } from 'react';
import { type IconType } from 'react-icons';
import { FaJsSquare } from 'react-icons/fa';
import { RiNextjsFill } from 'react-icons/ri';
import {
  SiDeno,
  SiGo,
  SiOpentelemetry,
  SiPython,
  SiRuby,
} from 'react-icons/si';
import {
  ActionIcon,
  Anchor,
  Box,
  Button,
  CopyButton,
  Drawer,
  Group,
  Loader,
  PasswordInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/nextjs';
import {
  IconArrowRight,
  IconArrowUpRight,
  IconCheck,
  IconCloud,
  IconCopy,
  IconDatabase,
  IconEye,
  IconEyeOff,
  IconHelpCircle,
  IconLayoutGrid,
  IconNotebook,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconRobot,
  IconServer,
  IconSettings,
  IconSparkles,
  IconTable,
  IconTerminal2,
} from '@tabler/icons-react';

import {
  CheckCircle,
  StatusPill,
  SummaryRow,
} from '@/components/GettingStarted/SummaryRow';
import { IntegrationsDrawer } from '@/components/IntegrationsDrawer';
import { LogoBadge } from '@/components/LogoBadge/LogoBadge';

import {
  OnboardingAccordion,
  type OnboardingStep,
  type OnboardingStepStatus,
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

function IntegrationsCard({
  onBrowse,
  onLanguageSdks,
}: {
  onBrowse?: () => void;
  onLanguageSdks?: () => void;
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

function OnboardingLink({
  label,
  onClick,
}: {
  label: string;
  onClick?: () => void;
}) {
  return (
    <Anchor
      href="#"
      underline="never"
      onClick={e => {
        e.preventDefault();
        onClick?.();
      }}
    >
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

function SendTelemetryBody({ onCheck }: { onCheck?: () => void }) {
  const [drawerCategory, setDrawerCategory] = useState<string | null>(null);
  return (
    <Stack gap={20}>
      <ConnectionPanel />

      <Box style={{ height: 1, background: 'var(--color-border)' }} />

      <IntegrationsCard
        onBrowse={() => setDrawerCategory('all')}
        onLanguageSdks={() => setDrawerCategory('languages')}
      />

      <CheckTelemetryRow onCheck={onCheck} />

      <IntegrationsDrawer
        opened={drawerCategory !== null}
        onClose={() => setDrawerCategory(null)}
        endpoint={ENDPOINT}
        apiKey={API_KEY}
        initialCategory={drawerCategory ?? 'all'}
      />
    </Stack>
  );
}

function CheckTelemetryRow({ onCheck }: { onCheck?: () => void }) {
  return (
    <Group gap={12} align="center">
      <Button
        variant="secondary"
        size="xs"
        onClick={onCheck}
        leftSection={<IconRefresh size={13} />}
      >
        Check for telemetry
      </Button>
      <Text fz={12} style={{ color: 'var(--color-text-muted)' }}>
        Once data is detected your next cards will be ready to use
      </Text>
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Self-managed (open source) send-telemetry body
//
// Unlike the fully-managed flow (which just hands the user an ingestion
// endpoint), self-managed users run their own collector. They first pick a
// collector flavor (OpenTelemetry / Vector), then copy a command to either
// start a fresh collector or wire ClickStack into an existing one.
// ---------------------------------------------------------------------------

/** Vector.dev mark — react-icons has no vector.dev logo, so we inline one. */
function VectorLogo({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={(size * 24) / 20}
      viewBox="0 0 20 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block' }}
    >
      <path d="M2 2.5h16L11 12v8.5L9 19.5V12L2 2.5z" fill="#10b8b0" />
    </svg>
  );
}

interface CollectorSource {
  value: string;
  label: string;
  recommended?: boolean;
  logo: ReactNode;
  /** Noun used in the instruction sentence ("Use the … below"). */
  noun: string;
}

const COLLECTOR_SOURCES: CollectorSource[] = [
  {
    value: 'otel',
    label: 'OpenTelemetry',
    recommended: true,
    logo: <SiOpentelemetry size={22} color="#f5a800" />,
    noun: 'OpenTelemetry Collector',
  },
  {
    value: 'vector',
    label: 'Vector',
    logo: <VectorLogo size={20} />,
    noun: 'Vector pipeline',
  },
];

const COLLECTOR_TABS = [
  { value: 'start', label: 'Start collector' },
  { value: 'existing', label: 'Configure existing collector' },
];

const COLLECTOR_SNIPPETS: Record<string, Record<string, string>> = {
  otel: {
    start: `export CLICKHOUSE_ENDPOINT=<CLICKHOUSE_ENDPOINT>
export CLICKHOUSE_PASSWORD=<CLICKHOUSE_PASSWORD>
docker run \\
  -e CLICKHOUSE_ENDPOINT=\${CLICKHOUSE_ENDPOINT} \\
  -e CLICKHOUSE_USER=default -e CLICKHOUSE_PASSWORD=\${CLICKHOUSE_PASSWORD} \\
  -p 4317:4317 -p 4318:4318 clickhouse/clickstack-otel-collector:latest`,
    existing: `# Add ClickStack's ClickHouse exporter to your collector config
exporters:
  clickhouse:
    endpoint: <CLICKHOUSE_ENDPOINT>
    username: default
    password: <CLICKHOUSE_PASSWORD>

service:
  pipelines:
    logs:    { exporters: [clickhouse] }
    traces:  { exporters: [clickhouse] }
    metrics: { exporters: [clickhouse] }`,
  },
  vector: {
    start: `export CLICKHOUSE_ENDPOINT=<CLICKHOUSE_ENDPOINT>
export CLICKHOUSE_PASSWORD=<CLICKHOUSE_PASSWORD>
docker run \\
  -e CLICKHOUSE_ENDPOINT=\${CLICKHOUSE_ENDPOINT} \\
  -e CLICKHOUSE_PASSWORD=\${CLICKHOUSE_PASSWORD} \\
  -p 4317:4317 -p 4318:4318 timberio/vector:latest-debian`,
    existing: `# vector.toml — add a ClickHouse sink
[sinks.clickhouse]
type = "clickhouse"
inputs = ["my_source"]
endpoint = "<CLICKHOUSE_ENDPOINT>"
database = "default"
table = "otel"
auth.strategy = "basic"
auth.user = "default"
auth.password = "<CLICKHOUSE_PASSWORD>"`,
  },
};

function RecommendedBadge() {
  return (
    <Box
      px={8}
      py={2}
      style={{ borderRadius: 1000, background: 'var(--color-bg-muted)' }}
    >
      <Text fz={12} fw={500} style={{ color: 'var(--color-text-muted)' }}>
        Recommended
      </Text>
    </Box>
  );
}

function CollectorSourceCard({
  source,
  active,
  onSelect,
}: {
  source: CollectorSource;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <UnstyledButton
      onClick={onSelect}
      aria-pressed={active}
      style={{
        flex: 1,
        minWidth: 0,
        borderRadius: 4,
        padding: '12px 24px',
        border: `1px solid ${
          active ? 'var(--color-text)' : 'var(--color-border)'
        }`,
      }}
    >
      <Group gap={16} align="center" wrap="nowrap">
        <Box style={{ display: 'flex', flexShrink: 0 }}>{source.logo}</Box>
        <Group
          gap={8}
          align="center"
          wrap="nowrap"
          style={{ flex: 1, minWidth: 0 }}
        >
          <Text fw={600} fz={14} style={{ color: 'var(--color-text)' }}>
            {source.label}
          </Text>
          {source.recommended ? <RecommendedBadge /> : null}
        </Group>
      </Group>
    </UnstyledButton>
  );
}

function UnderlineTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Group gap={0} style={{ borderBottom: '1px solid var(--color-border)' }}>
      {tabs.map(t => {
        const active = t.value === value;
        return (
          <UnstyledButton
            key={t.value}
            onClick={() => onChange(t.value)}
            style={{
              padding: '8px 12px',
              marginBottom: -1,
              borderBottom: `2px solid ${
                active ? 'var(--color-text)' : 'transparent'
              }`,
            }}
          >
            <Text
              fz={14}
              style={{
                color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
              }}
            >
              {t.label}
            </Text>
          </UnstyledButton>
        );
      })}
    </Group>
  );
}

function CommandBlock({ code }: { code: string }) {
  return (
    <Box
      style={{
        position: 'relative',
        background: 'var(--color-bg-muted)',
        borderRadius: 4,
      }}
    >
      <Box
        component="pre"
        style={{
          margin: 0,
          padding: '16px 52px 16px 16px',
          fontFamily:
            'var(--mantine-font-family-monospace, ui-monospace, monospace)',
          fontSize: 13,
          lineHeight: 1.7,
          color: 'var(--color-text)',
          whiteSpace: 'pre',
          overflowX: 'auto',
        }}
      >
        {code}
      </Box>
      <CopyButton value={code}>
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
  );
}

/**
 * Contextual data-source hint, shown only for custom-ingestion paths (e.g.
 * Vector) where telemetry lands in a table the user defines. ClickStack
 * auto-detects standard OpenTelemetry tables, so the common path needs nothing
 * here — but a custom table must be registered as a data source before it's
 * queryable in Search and dashboards. In the app this link opens the sources
 * drawer (CreateSourcesPanel); here it's a mock.
 */
function CustomSourceCallout() {
  return (
    <Group
      gap={12}
      align="flex-start"
      wrap="nowrap"
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        background: 'var(--color-bg-muted)',
        padding: '14px 16px',
      }}
    >
      <Box style={{ display: 'flex', flexShrink: 0, marginTop: 2 }}>
        <IconDatabase size={18} style={{ color: 'var(--color-text-muted)' }} />
      </Box>
      <Stack gap={6} style={{ minWidth: 0 }}>
        <Text fz={14} fw={600} style={{ color: 'var(--color-text)' }}>
          Ingesting into a custom table?
        </Text>
        <Text fz={13} lh={1.5} style={{ color: 'var(--color-text-muted)' }}>
          ClickStack auto-detects standard OpenTelemetry tables. If your
          pipeline writes to a table you define, create a data source so
          ClickStack can query it in Search and dashboards.
        </Text>
        <OnboardingLink label="Create a data source" />
      </Stack>
    </Group>
  );
}

/**
 * The collector setup itself — source picker (OpenTelemetry / Vector), the
 * start-vs-existing tabs, and the copy-paste command. This is the heavy part
 * that used to bloat the step; it now lives in a flyout opened from a summary
 * card.
 */
function CollectorSetupBody() {
  const [source, setSource] = useState('otel');
  const [tab, setTab] = useState('start');
  const activeSource =
    COLLECTOR_SOURCES.find(s => s.value === source) ?? COLLECTOR_SOURCES[0];
  const code = COLLECTOR_SNIPPETS[source][tab];

  return (
    <Stack gap={22}>
      <Group gap={16} align="center" wrap="nowrap">
        {COLLECTOR_SOURCES.map(s => (
          <CollectorSourceCard
            key={s.value}
            source={s}
            active={s.value === source}
            onSelect={() => setSource(s.value)}
          />
        ))}
      </Group>

      <Stack gap={10}>
        <Text fz={14} lh={1.5} style={{ color: 'var(--color-text)' }}>
          Use the {activeSource.noun} below to send data to ClickStack. Start a
          new collector if needed, or refer to the example for configuring an
          existing one.
        </Text>
        <UnderlineTabs tabs={COLLECTOR_TABS} value={tab} onChange={setTab} />
        <CommandBlock code={code} />
        <Text fz={13} lh={1.5} style={{ color: 'var(--color-text-muted)' }}>
          Replace{' '}
          <Text
            component="span"
            ff="var(--mantine-font-family-monospace, ui-monospace, monospace)"
            style={{ color: 'var(--color-text)' }}
          >
            {'<CLICKHOUSE_PASSWORD>'}
          </Text>{' '}
          with the password shown when the service was created. If you no longer
          have it, you can reset it from the{' '}
          <Anchor href="#" underline="never" onClick={e => e.preventDefault()}>
            <Text
              component="span"
              fz={13}
              style={{
                color: 'var(--click-global-color-text-link-default, #437eef)',
              }}
            >
              ClickHouse Cloud Console
            </Text>
          </Anchor>
          .
        </Text>
      </Stack>

      {source === 'vector' ? <CustomSourceCallout /> : null}
    </Stack>
  );
}

function SelfManagedSendTelemetryBody({ onCheck }: { onCheck?: () => void }) {
  const [setupOpen, setSetupOpen] = useState(false);
  const [drawerCategory, setDrawerCategory] = useState<string | null>(null);

  return (
    <Stack gap={16}>
      <SummaryRow
        icon={<IconTerminal2 size={18} />}
        title="Run a collector"
        description="Ship your logs, traces, and metrics to ClickStack with an OpenTelemetry or Vector collector — start a fresh one or wire up an existing pipeline."
        footer={
          <Button variant="primary" onClick={() => setSetupOpen(true)}>
            View setup instructions
          </Button>
        }
      />

      <IntegrationsCard
        onBrowse={() => setDrawerCategory('all')}
        onLanguageSdks={() => setDrawerCategory('languages')}
      />

      <CheckTelemetryRow onCheck={onCheck} />

      <Drawer
        opened={setupOpen}
        onClose={() => setSetupOpen(false)}
        position="right"
        size={640}
        title={
          <DrawerTitle
            title="Send telemetry with a collector"
            subtitle="Pick a collector and copy the command to start streaming data into ClickStack."
          />
        }
      >
        <CollectorSetupBody />
      </Drawer>

      <IntegrationsDrawer
        opened={drawerCategory !== null}
        onClose={() => setDrawerCategory(null)}
        endpoint={ENDPOINT}
        apiKey={API_KEY}
        initialCategory={drawerCategory ?? 'all'}
      />
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

// ---------------------------------------------------------------------------
// Explore step — "what to try next" checklist
//
// Once telemetry is flowing, the final step is a short to-do list of the
// highest-value things to do in the product. Each item can be ticked off (or
// "done" by following its CTA); when every item is complete the whole
// getting-started experience is dismissed. The Notebooks item only applies to
// the managed flows (it isn't part of open-source ClickStack).
// ---------------------------------------------------------------------------

interface ExploreTodo {
  id: string;
  icon: ReactNode;
  title: string;
  description: string;
  cta: string;
}

const TODO_EXPLORE: ExploreTodo = {
  id: 'explore',
  icon: <IconTable size={18} />,
  title: 'Explore your data',
  description: 'Search and filter your logs and traces in the Search view.',
  cta: 'Open Search',
};

const TODO_MCP: ExploreTodo = {
  id: 'mcp',
  icon: <IconRobot size={18} />,
  title: 'Set up the MCP server',
  description:
    'Let AI agents query your telemetry over the Model Context Protocol.',
  cta: 'Configure MCP',
};

const TODO_NOTEBOOKS: ExploreTodo = {
  id: 'notebooks',
  icon: <IconNotebook size={18} />,
  title: 'Create a notebook',
  description:
    'Investigate incidents step-by-step in a collaborative notebook.',
  cta: 'Open Notebooks',
};

const TODO_DASHBOARD: ExploreTodo = {
  id: 'dashboard',
  icon: <IconLayoutGrid size={18} />,
  title: 'Build a dashboard',
  description: 'Chart the metrics that matter and share them with your team.',
  cta: 'Create a dashboard',
};

/** Open-source flow has no Notebooks. */
const OSS_EXPLORE_TODOS: ExploreTodo[] = [
  TODO_EXPLORE,
  TODO_MCP,
  TODO_DASHBOARD,
];

/** Managed flows (fully- and self-managed) include Notebooks. */
const MANAGED_EXPLORE_TODOS: ExploreTodo[] = [
  TODO_EXPLORE,
  TODO_MCP,
  TODO_NOTEBOOKS,
  TODO_DASHBOARD,
];

function ExploreTodoRow({
  item,
  done,
  onToggle,
}: {
  item: ExploreTodo;
  done: boolean;
  onToggle: () => void;
}) {
  return (
    <Group
      gap={12}
      align="center"
      wrap="nowrap"
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        padding: '14px 16px',
        background: done ? 'var(--color-bg-muted)' : 'var(--color-bg-body)',
      }}
    >
      <UnstyledButton
        onClick={onToggle}
        aria-pressed={done}
        aria-label={
          done ? `Mark "${item.title}" not done` : `Mark "${item.title}" done`
        }
        style={{ display: 'flex', flexShrink: 0 }}
      >
        <CheckCircle done={done} />
      </UnstyledButton>
      <CardChip bg="var(--color-bg-muted)" color="var(--color-text-muted)">
        {item.icon}
      </CardChip>
      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Text
          fz={15}
          fw={600}
          style={{
            color: 'var(--color-text)',
            textDecoration: done ? 'line-through' : 'none',
            opacity: done ? 0.7 : 1,
          }}
        >
          {item.title}
        </Text>
        <Text fz={13} lh={1.4} style={{ color: 'var(--color-text-muted)' }}>
          {item.description}
        </Text>
      </Stack>
      <StatusPill done={done} />
      <Anchor
        href="#"
        underline="never"
        onClick={e => e.preventDefault()}
        style={{ flexShrink: 0 }}
      >
        <Group gap={4} align="center" wrap="nowrap">
          <Text fz={14} fw={500} style={{ color: 'var(--color-text-muted)' }}>
            {item.cta}
          </Text>
          <IconArrowRight
            size={14}
            style={{ color: 'var(--color-text-muted)' }}
          />
        </Group>
      </Anchor>
    </Group>
  );
}

function ExploreTodoList({
  items,
  completed,
  onToggle,
}: {
  items: ExploreTodo[];
  completed: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <Stack gap={12}>
      {items.map(item => (
        <ExploreTodoRow
          key={item.id}
          item={item}
          done={completed.includes(item.id)}
          onToggle={() => onToggle(item.id)}
        />
      ))}
    </Stack>
  );
}

function useExploreTodos(items: ExploreTodo[]) {
  const [completed, setCompleted] = useState<string[]>([]);
  const toggle = (id: string) =>
    setCompleted(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    );
  const allDone =
    items.length > 0 && items.every(item => completed.includes(item.id));
  return { completed, toggle, allDone };
}

/** Shown in place of the accordion once every checklist item is complete. */
function OnboardingDismissed() {
  return (
    <Group justify="center" py={48}>
      <Text fz={14} style={{ color: 'var(--color-text-muted)' }}>
        All set — getting started has been dismissed.
      </Text>
    </Group>
  );
}

const EXPLORE_STEP_DESCRIPTION =
  'Your telemetry is flowing. Tick off these last few things to get the most out of ClickStack.';

const EXPLORE_STEP: OnboardingStep = {
  id: 'explore-telemetry',
  title: 'Explore your telemetry',
  status: 'upcoming',
  description: EXPLORE_STEP_DESCRIPTION,
  children: (
    <ExploreTodoList
      items={MANAGED_EXPLORE_TODOS}
      completed={[]}
      onToggle={() => undefined}
    />
  ),
};

// ---------------------------------------------------------------------------
// Connect-service step (self-managed)
//
// Self-managed users bring their own ClickHouse Cloud service (shared across
// ClickHouse Cloud and ClickStack). They pick an existing service or, if none
// exist yet, create one in ClickHouse Cloud and refresh to discover it. Once a
// service is connected its region is shown alongside a "managed in ClickHouse
// Cloud" hint, and the flow advances to "Send telemetry".
// ---------------------------------------------------------------------------

interface ServiceInfo {
  id: string;
  name: string;
  region: string;
}

/** Services "discovered" after the user creates one and hits refresh. */
const DISCOVERABLE_SERVICES: ServiceInfo[] = [
  { id: 'svc-prod', name: 'Production', region: 'AWS (us-east-1)' },
  { id: 'svc-staging', name: 'Staging', region: 'GCP (europe-west4)' },
];

/**
 * Compact summary of the connected service: name, region, and either a
 * managed-by hint (preview) or a "Change" action (once connected).
 */
function ConnectedServiceRow({
  service,
  onChange,
}: {
  service: ServiceInfo;
  onChange?: () => void;
}) {
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
                {service.name}
              </Text>
              <IconPencil
                size={12}
                style={{ color: 'var(--color-text-muted)' }}
              />
            </Group>
            <Text fz={13} style={{ color: 'var(--color-text-muted)' }}>
              {service.region}
            </Text>
          </Group>
        </Group>
        {onChange ? (
          <UnstyledButton onClick={onChange} style={{ flexShrink: 0 }}>
            <Text
              fz={13}
              fw={500}
              style={{
                color: 'var(--click-global-color-text-link-default, #437eef)',
              }}
            >
              Change
            </Text>
          </UnstyledButton>
        ) : (
          <Group gap={6} align="center" wrap="nowrap" style={{ flexShrink: 0 }}>
            <IconCloud size={14} style={{ color: 'var(--color-text-muted)' }} />
            <Text fz={12} style={{ color: 'var(--color-text-muted)' }}>
              Managed in ClickHouse Cloud
            </Text>
          </Group>
        )}
      </Group>
    </Box>
  );
}

function ConnectServiceBody({
  services,
  checking,
  onRefresh,
  initialSelectedId,
  onConnect,
}: {
  services: ServiceInfo[];
  checking: boolean;
  onRefresh: () => void;
  initialSelectedId?: string | null;
  onConnect: (service: ServiceInfo) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedId ?? null,
  );

  const selected = services.find(s => s.id === selectedId) ?? null;

  if (services.length === 0) {
    return (
      <Stack
        gap={14}
        align="center"
        style={{
          border: '1px dashed var(--color-border-emphasis)',
          borderRadius: 8,
          padding: '28px 24px',
          background: 'var(--color-bg-muted)',
        }}
      >
        <LogoBadge size={44} radius={10}>
          <ServiceLogo size={24} />
        </LogoBadge>
        <Stack gap={4} align="center">
          <Text fw={600} fz={15} style={{ color: 'var(--color-text)' }}>
            No ClickHouse services found
          </Text>
          <Text
            fz={13}
            ta="center"
            lh={1.5}
            style={{ color: 'var(--color-text-muted)', maxWidth: 420 }}
          >
            Create a service in ClickHouse Cloud, then refresh to connect it
            here. Services are shared across ClickHouse Cloud and ClickStack.
          </Text>
        </Stack>
        <Group gap={10}>
          <Button
            variant="primary"
            size="sm"
            component="a"
            href="#"
            onClick={e => e.preventDefault()}
            rightSection={<IconArrowUpRight size={15} />}
          >
            Create service in ClickHouse Cloud
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            disabled={checking}
            leftSection={
              checking ? <Loader size={13} /> : <IconRefresh size={15} />
            }
          >
            {checking ? 'Checking…' : 'Refresh'}
          </Button>
        </Group>
      </Stack>
    );
  }

  return (
    <Stack gap={16}>
      <Stack gap={6}>
        <Text fz={13} fw={500} style={{ color: 'var(--color-text)' }}>
          Select a service
        </Text>
        <Select
          placeholder="Choose a ClickHouse Cloud service"
          data={services.map(s => ({
            value: s.id,
            label: `${s.name} · ${s.region}`,
          }))}
          value={selectedId}
          onChange={setSelectedId}
          comboboxProps={{ withinPortal: false }}
        />
      </Stack>

      {selected ? <ConnectedServiceRow service={selected} /> : null}

      <Group justify="space-between" align="center">
        <Anchor href="#" underline="never" onClick={e => e.preventDefault()}>
          <Group gap={5} align="center" wrap="nowrap">
            <IconArrowUpRight
              size={14}
              style={{ color: 'var(--color-text-muted)' }}
            />
            <Text fz={13} style={{ color: 'var(--color-text-muted)' }}>
              Create a new service in ClickHouse Cloud
            </Text>
          </Group>
        </Anchor>
        <Button
          variant="primary"
          size="sm"
          disabled={!selected}
          onClick={() => selected && onConnect(selected)}
        >
          Use this service
        </Button>
      </Group>
    </Stack>
  );
}

/** Completed "Send telemetry" summary shown once data is detected. */
function TelemetryFlowingSummary() {
  return (
    <Text fz={14} style={{ color: 'var(--color-text-muted)' }}>
      Telemetry is flowing — logs and traces detected.
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Step-by-step flow plumbing
//
// Each onboarding walks the user through an ordered list of steps: exactly one
// is "active" (the first incomplete step) and open, earlier steps are
// "complete" (summary stays visible), and later steps are "upcoming".
// Completing a step advances focus to the next one.
// ---------------------------------------------------------------------------

function useStepFlow(order: string[]) {
  const [completed, setCompleted] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(order[0] ?? null);

  const firstIncomplete = order.find(id => !completed.includes(id)) ?? null;

  const statusOf = (id: string): OnboardingStepStatus => {
    if (completed.includes(id)) return 'complete';
    if (id === firstIncomplete) return 'active';
    return 'upcoming';
  };

  const complete = (id: string) => {
    setCompleted(prev => (prev.includes(id) ? prev : [...prev, id]));
    setOpen(order[order.indexOf(id) + 1] ?? null);
  };

  // Re-open a previously completed step (and reset everything after it).
  const reopen = (id: string) => {
    const idx = order.indexOf(id);
    setCompleted(prev => prev.filter(c => order.indexOf(c) < idx));
    setOpen(id);
  };

  return { open, setOpen, statusOf, complete, reopen };
}

function connectServiceStep(
  status: OnboardingStepStatus,
  {
    service,
    services,
    checking,
    onRefresh,
    onConnect,
    onChange,
  }: {
    service: ServiceInfo | null;
    services: ServiceInfo[];
    checking: boolean;
    onRefresh: () => void;
    onConnect: (s: ServiceInfo) => void;
    onChange: () => void;
  },
): OnboardingStep {
  if (status === 'complete' && service) {
    return {
      id: 'connect-service',
      title: 'Connect your ClickHouse service',
      status,
      meta: 'Managed in ClickHouse Cloud',
      children: <ConnectedServiceRow service={service} onChange={onChange} />,
    };
  }
  return {
    id: 'connect-service',
    title: 'Connect your ClickHouse service',
    status,
    description:
      'Choose the ClickHouse Cloud service where ClickStack will store your telemetry. Services are shared between ClickHouse Cloud and ClickStack.',
    children: (
      <ConnectServiceBody
        services={services}
        checking={checking}
        onRefresh={onRefresh}
        initialSelectedId={service?.id}
        onConnect={onConnect}
      />
    ),
  };
}

function sendTelemetryStep(
  status: OnboardingStepStatus,
  activeBody: ReactNode,
): OnboardingStep {
  return {
    id: 'send-telemetry',
    title: 'Send telemetry',
    status,
    description:
      status === 'complete'
        ? undefined
        : 'Point your OpenTelemetry collector or SDK at this endpoint',
    meta: status === 'complete' ? 'Receiving data' : undefined,
    children: status === 'complete' ? <TelemetryFlowingSummary /> : activeBody,
  };
}

function exploreStep(
  status: OnboardingStepStatus,
  body: ReactNode,
): OnboardingStep {
  return { ...EXPLORE_STEP, status, children: body };
}

// ---------------------------------------------------------------------------
// Connect-to-ClickHouse step (OSS / self-hosted)
//
// Mirrors the existing open-source "Welcome to ClickStack" connection modal,
// adapted into the getting-started accordion: point ClickStack at a ClickHouse
// server (or the demo server). Kept intentionally close to what ships in main.
// ---------------------------------------------------------------------------

/** Drawer title matching the app's getting-started drawers. */
function DrawerTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <Stack gap={2}>
      <Text fw={700} fz={18} style={{ color: 'var(--color-text)' }}>
        {title}
      </Text>
      <Text fz={13} style={{ color: 'var(--color-text-muted)' }}>
        {subtitle}
      </Text>
    </Stack>
  );
}

/** The (tall) connection form — lives inside the connect drawer. */
function ConnectClickHouseForm({ onConnect }: { onConnect: () => void }) {
  return (
    <Stack gap="md">
      <Text fz={14} style={{ color: 'var(--color-text-muted)' }}>
        Connect to your ClickHouse server to start querying telemetry.
      </Text>
      <TextInput label="Connection Name" defaultValue="Default" />
      <TextInput
        label={
          <Group gap={6} align="center" wrap="nowrap" component="span">
            <span>Host</span>
            <IconHelpCircle
              size={14}
              style={{ color: 'var(--color-text-muted)' }}
            />
          </Group>
        }
        defaultValue="http://localhost:8123"
      />
      <TextInput label="Username" defaultValue="default" />
      <PasswordInput label="Password" placeholder="Password (default: blank)" />
      <Anchor href="#" underline="never" onClick={e => e.preventDefault()}>
        <Group gap={6} align="center" wrap="nowrap">
          <IconSettings
            size={14}
            style={{
              color: 'var(--click-global-color-text-link-default, #437eef)',
            }}
          />
          <Text
            fz={13}
            fw={500}
            style={{
              color: 'var(--click-global-color-text-link-default, #437eef)',
            }}
          >
            Advanced Settings
          </Text>
        </Group>
      </Anchor>
      <Group justify="flex-end" align="center" gap="sm">
        <Button variant="secondary" size="sm">
          Test Connection
        </Button>
        <Button variant="primary" size="sm" onClick={onConnect}>
          Create Connection
        </Button>
      </Group>
    </Stack>
  );
}

/** Manual source setup — lives inside the data-sources drawer (fallback). */
function SourcesDrawerForm({ onCreate }: { onCreate: () => void }) {
  return (
    <Stack gap="md">
      <Text fz={14} style={{ color: 'var(--color-text-muted)' }}>
        We couldn’t auto-detect any OpenTelemetry tables. Point ClickStack at
        the table that holds your telemetry.
      </Text>
      <TextInput label="Source Name" defaultValue="Logs" />
      <TextInput label="Database" defaultValue="default" />
      <TextInput label="Table" placeholder="otel_logs" />
      <TextInput label="Timestamp Column" defaultValue="TimestampTime" />
      <Group justify="flex-end" align="center">
        <Button variant="primary" size="sm" onClick={onCreate}>
          Create Source
        </Button>
      </Group>
    </Stack>
  );
}

interface OssConnectBodyProps {
  connected: boolean;
  hasSources: boolean;
  onConnect: () => void;
  onDemo: () => void;
  onAutoDetected: () => void;
  onCreateSources: () => void;
}

/**
 * OSS connect step body: two compact cards (connection + data sources). The
 * demo-vs-manual choice lives on the connection card; manual opens a drawer.
 * Once connected, the data-sources card automatically runs auto-detect (with a
 * manual-source drawer as the fallback). Mirrors the live getting-started page
 * so Storybook and the app stay in sync.
 */
function OssConnectBody({
  connected,
  hasSources,
  onConnect,
  onDemo,
  onAutoDetected,
  onCreateSources,
}: OssConnectBodyProps) {
  const [connDrawer, setConnDrawer] = useState(false);
  const [sourcesDrawer, setSourcesDrawer] = useState(false);
  const [detectAttempted, setDetectAttempted] = useState(false);

  // Simulate auto-detecting OTel tables once a connection exists. (The demo
  // path provisions its own sources, so `hasSources` is already true there and
  // this is skipped.) For the demo we always "find" tables; the manual fallback
  // drawer is still reachable from the data-sources card.
  useEffect(() => {
    if (!connected || hasSources || detectAttempted) return;
    const t = setTimeout(() => {
      setDetectAttempted(true);
      onAutoDetected();
    }, 1200);
    return () => clearTimeout(t);
  }, [connected, hasSources, detectAttempted, onAutoDetected]);

  const detecting = connected && !hasSources && !detectAttempted;

  let sourcesSummary: string;
  let sourcesAction: ReactNode;
  let sourcesFooter: ReactNode;
  if (!connected) {
    sourcesSummary =
      'Connect to ClickHouse above and we’ll automatically find the tables that hold your telemetry.';
  } else if (hasSources) {
    sourcesSummary = '4 sources ready: Demo Logs, Demo Traces, +2 more';
    sourcesAction = (
      <Button variant="subtle" onClick={() => setSourcesDrawer(true)}>
        Manage
      </Button>
    );
  } else if (detecting) {
    sourcesSummary =
      'Looking for OpenTelemetry tables in your ClickHouse server…';
    sourcesAction = <Loader size="sm" />;
  } else {
    sourcesSummary =
      'We couldn’t find any OpenTelemetry tables automatically. Add one to tell ClickStack where your telemetry lives.';
    sourcesFooter = (
      <Button
        variant="primary"
        leftSection={<IconPlus size={16} />}
        onClick={() => setSourcesDrawer(true)}
      >
        Add a data source
      </Button>
    );
  }

  return (
    <Stack gap="md">
      <SummaryRow
        done={connected}
        icon={<IconServer size={18} />}
        title={connected ? 'Connected to ClickHouse' : 'Connect to ClickHouse'}
        description={
          connected
            ? 'http://localhost:8123'
            : 'Explore straight away with our hosted demo data, or connect the ClickHouse server that already stores your telemetry.'
        }
        action={
          connected ? (
            <Button variant="subtle" onClick={() => setConnDrawer(true)}>
              Manage
            </Button>
          ) : undefined
        }
        footer={
          connected ? undefined : (
            <>
              <Button variant="secondary" onClick={onDemo}>
                Use the demo server
              </Button>
              <Button variant="secondary" onClick={() => setConnDrawer(true)}>
                Connect your ClickHouse
              </Button>
            </>
          )
        }
      />
      <SummaryRow
        done={hasSources}
        icon={<IconDatabase size={18} />}
        title="Data sources"
        description={sourcesSummary}
        action={sourcesAction}
        footer={sourcesFooter}
      />

      <Drawer
        opened={connDrawer}
        onClose={() => setConnDrawer(false)}
        position="right"
        size={640}
        title={
          <DrawerTitle
            title="ClickHouse connection"
            subtitle="Point ClickStack at the ClickHouse server that stores your telemetry."
          />
        }
      >
        <ConnectClickHouseForm
          onConnect={() => {
            onConnect();
            setConnDrawer(false);
          }}
        />
      </Drawer>

      <Drawer
        opened={sourcesDrawer}
        onClose={() => setSourcesDrawer(false)}
        position="right"
        size={640}
        title={
          <DrawerTitle
            title="Add a data source"
            subtitle="Point ClickStack at the table that holds your telemetry."
          />
        }
      >
        <SourcesDrawerForm
          onCreate={() => {
            onCreateSources();
            setSourcesDrawer(false);
          }}
        />
      </Drawer>
    </Stack>
  );
}

function connectClickHouseStep(
  status: OnboardingStepStatus,
  body: OssConnectBodyProps,
): OnboardingStep {
  return {
    id: 'connect-clickhouse',
    title: 'Connect to ClickHouse',
    status,
    collapsible: true,
    meta: status === 'complete' ? 'Connected' : undefined,
    description:
      status === 'complete'
        ? undefined
        : 'Point ClickStack at your ClickHouse server and pick the tables that hold your telemetry — or spin up a demo server.',
    children: <OssConnectBody {...body} />,
  };
}

/** Cloud / fully-managed flow: ClickStack hands you an ingestion endpoint. */
const FULLY_MANAGED_STEPS: OnboardingStep[] = [
  {
    id: 'send-telemetry',
    title: 'Send telemetry',
    status: 'active',
    description: 'Point your OpenTelemetry collector or SDK at this endpoint',
    children: <SendTelemetryBody />,
  },
  EXPLORE_STEP,
];

function DeploymentLink({ label }: { label: string }) {
  return (
    <Anchor href="#" underline="never" onClick={e => e.preventDefault()}>
      <Text
        span
        fz={14}
        fw={500}
        style={{
          color: 'var(--click-global-color-text-link-default, #437eef)',
        }}
      >
        {label}
      </Text>
    </Anchor>
  );
}

const FULLY_MANAGED_DESCRIPTION = (
  <>
    We run everything — you just send your data. Rather manage it all yourself?{' '}
    <DeploymentLink label="Go self-managed →" />
  </>
);

const SELF_MANAGED_DESCRIPTION = (
  <>
    Don’t want to manage it all yourself?{' '}
    <DeploymentLink label="Go fully-managed →" />
  </>
);

const OSS_DESCRIPTION = (
  <>
    Connect to your ClickHouse server to start querying and exploring your
    telemetry.
  </>
);

// ---------------------------------------------------------------------------
// Story flows — each drives the accordion step-by-step via useStepFlow.
// ---------------------------------------------------------------------------

/**
 * Cloud / fully-managed: the service is already provisioned (shown in the
 * banner), so the flow is just Send telemetry → Explore.
 */
function FullyManagedFlow() {
  const flow = useStepFlow(['send-telemetry', 'explore-telemetry']);
  const todos = useExploreTodos(MANAGED_EXPLORE_TODOS);

  if (todos.allDone) return <OnboardingDismissed />;

  return (
    <OnboardingAccordion
      title="Start sending telemetry"
      description={FULLY_MANAGED_DESCRIPTION}
      banner={<ServiceSummaryBanner />}
      openStep={flow.open}
      onOpenStepChange={flow.setOpen}
      steps={[
        sendTelemetryStep(
          flow.statusOf('send-telemetry'),
          <SendTelemetryBody onCheck={() => flow.complete('send-telemetry')} />,
        ),
        exploreStep(
          flow.statusOf('explore-telemetry'),
          <ExploreTodoList
            items={MANAGED_EXPLORE_TODOS}
            completed={todos.completed}
            onToggle={todos.toggle}
          />,
        ),
      ]}
    />
  );
}

/**
 * Self-managed: bring your own ClickHouse Cloud service. The first step is
 * connecting that service, then Send telemetry → Explore.
 */
function SelfManagedFlow() {
  const flow = useStepFlow([
    'connect-service',
    'send-telemetry',
    'explore-telemetry',
  ]);
  const [service, setService] = useState<ServiceInfo | null>(null);
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [checking, setChecking] = useState(false);
  const todos = useExploreTodos(MANAGED_EXPLORE_TODOS);

  // Simulate polling ClickHouse Cloud for services the user just created. The
  // discovered list lives here (not in the step body) so it survives the step
  // being reopened via "Change".
  const refresh = () => {
    setChecking(true);
    setTimeout(() => {
      setServices(DISCOVERABLE_SERVICES);
      setChecking(false);
    }, 700);
  };

  if (todos.allDone) return <OnboardingDismissed />;

  return (
    <OnboardingAccordion
      title="Start sending telemetry"
      description={SELF_MANAGED_DESCRIPTION}
      openStep={flow.open}
      onOpenStepChange={flow.setOpen}
      steps={[
        connectServiceStep(flow.statusOf('connect-service'), {
          service,
          services,
          checking,
          onRefresh: refresh,
          onConnect: svc => {
            setService(svc);
            flow.complete('connect-service');
          },
          onChange: () => flow.reopen('connect-service'),
        }),
        sendTelemetryStep(
          flow.statusOf('send-telemetry'),
          <SelfManagedSendTelemetryBody
            onCheck={() => flow.complete('send-telemetry')}
          />,
        ),
        exploreStep(
          flow.statusOf('explore-telemetry'),
          <ExploreTodoList
            items={MANAGED_EXPLORE_TODOS}
            completed={todos.completed}
            onToggle={todos.toggle}
          />,
        ),
      ]}
    />
  );
}

/**
 * OSS (self-hosted ClickStack): the existing "Welcome to ClickStack"
 * connection modal, adapted into the getting-started page. Connect to a
 * ClickHouse server (or the demo), then explore. Intentionally close to main.
 */
function OssFlow() {
  const flow = useStepFlow(['connect-clickhouse', 'explore-telemetry']);
  const [connected, setConnected] = useState(false);
  const [hasSources, setHasSources] = useState(false);
  const todos = useExploreTodos(OSS_EXPLORE_TODOS);

  if (todos.allDone) return <OnboardingDismissed />;

  return (
    <OnboardingAccordion
      title="Get started with ClickStack"
      description={OSS_DESCRIPTION}
      openStep={flow.open}
      onOpenStepChange={flow.setOpen}
      steps={[
        connectClickHouseStep(flow.statusOf('connect-clickhouse'), {
          connected,
          hasSources,
          // Manual connection: just establishes the connection. The data-sources
          // card then auto-detects on its own.
          // Both paths just establish the connection — the step stays open and
          // the data-sources card takes over in auto-detect mode.
          onConnect: () => setConnected(true),
          onDemo: () => setConnected(true),
          // Auto-detect found tables (or the user added one manually). Only now
          // does the connect step complete and collapse.
          onAutoDetected: () => {
            setHasSources(true);
            flow.complete('connect-clickhouse');
          },
          onCreateSources: () => {
            setHasSources(true);
            flow.complete('connect-clickhouse');
          },
        }),
        exploreStep(
          flow.statusOf('explore-telemetry'),
          <ExploreTodoList
            items={OSS_EXPLORE_TODOS}
            completed={todos.completed}
            onToggle={todos.toggle}
          />,
        ),
      ]}
    />
  );
}

/** Cloud onboarding — provisioned service banner, then step-by-step. */
export const FullyManaged: Story = {
  render: () => <FullyManagedFlow />,
};

/** Self-managed — connect a ClickHouse Cloud service, then send telemetry. */
export const SelfManaged: Story = {
  render: () => <SelfManagedFlow />,
};

/** Open-source self-hosted — the connection modal adapted into the page. */
export const OpenSource: Story = {
  render: () => <OssFlow />,
};

export const ExploreExpanded: Story = {
  args: {
    title: 'Start sending telemetry',
    description: FULLY_MANAGED_DESCRIPTION,
    banner: <ServiceSummaryBanner />,
    steps: FULLY_MANAGED_STEPS,
    defaultOpenStep: 'explore-telemetry',
  },
};

export const AllStepsCollapsed: Story = {
  args: {
    title: 'Start sending telemetry',
    description: FULLY_MANAGED_DESCRIPTION,
    banner: <ServiceSummaryBanner />,
    steps: FULLY_MANAGED_STEPS,
  },
};
