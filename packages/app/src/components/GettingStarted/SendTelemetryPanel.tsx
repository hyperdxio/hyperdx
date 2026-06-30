import { useState } from 'react';
import { type IconType } from 'react-icons';
import { FaJsSquare } from 'react-icons/fa';
import { RiNextjsFill } from 'react-icons/ri';
import { SiDeno, SiGo, SiPython, SiRuby } from 'react-icons/si';
import {
  ActionIcon,
  Box,
  Button,
  CopyButton,
  Group,
  Loader,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconArrowRight,
  IconCheck,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconSparkles,
} from '@tabler/icons-react';

import { LogoBadge } from '@/components/LogoBadge/LogoBadge';

import { IntegrationsDrawer } from './IntegrationsDrawer';

const MASKED_KEY = '••••••••••••••••••••••••';

/** Violet accent used to brand the AI setup assistant (theme-agnostic). */
const AI_ACCENT = '#7c5cff';

const AI_AGENTS = [
  { label: 'Cursor', value: 'cursor' },
  { label: 'VS Code', value: 'vscode' },
  { label: 'Claude Code', value: 'claude' },
];

function setupPrompt(endpoint: string, apiKey: string) {
  return `Set up HyperDX / OpenTelemetry observability in this project.

Instrument the application to export logs, traces, and metrics over OTLP/HTTP to:
  endpoint: ${endpoint}
  header:   authorization: ${apiKey}

Add the OpenTelemetry SDK for this project's language/framework, wire up auto-instrumentation, generate any collector config that's needed, then run the app and confirm telemetry is arriving.`;
}

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

function connectionSnippet(
  tab: string,
  endpoint: string,
  apiKey: string,
  revealed: boolean,
) {
  const key = revealed ? apiKey : MASKED_KEY;
  if (tab === 'collector') {
    return `exporters:
  otlphttp:
    endpoint: "${endpoint}"
    headers:
      authorization: "${key}"`;
  }
  if (tab === 'env') {
    return `OTEL_EXPORTER_OTLP_ENDPOINT=${endpoint}
OTEL_EXPORTER_OTLP_HEADERS=authorization=${key}`;
  }
  return `endpoint: ${endpoint}
api-key:  ${key}`;
}

function ConnectionPanel({
  endpoint,
  apiKey,
}: {
  endpoint: string;
  apiKey: string;
}) {
  const [tab, setTab] = useState('url');
  const [revealed, setRevealed] = useState(false);
  const isAi = tab === 'ai';
  const display = connectionSnippet(tab, endpoint, apiKey, revealed);
  const copyText = connectionSnippet(tab, endpoint, apiKey, true);

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
        <AIAgentTab endpoint={endpoint} apiKey={apiKey} />
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

function AIAgentTab({
  endpoint,
  apiKey,
}: {
  endpoint: string;
  apiKey: string;
}) {
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
        <CopyButton value={setupPrompt(endpoint, apiKey)}>
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

function IntegrationsCard({
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

export interface SendTelemetryPanelProps {
  endpoint: string;
  apiKey: string;
  onCheckTelemetry?: () => void;
  isChecking?: boolean;
}

export function SendTelemetryPanel({
  endpoint,
  apiKey,
  onCheckTelemetry,
  isChecking = false,
}: SendTelemetryPanelProps) {
  const [drawerOpened, drawer] = useDisclosure(false);
  const [drawerCategory, setDrawerCategory] = useState('all');

  const openDrawer = (category: string) => {
    setDrawerCategory(category);
    drawer.open();
  };

  return (
    <Stack gap={20}>
      <ConnectionPanel endpoint={endpoint} apiKey={apiKey} />

      <Box style={{ height: 1, background: 'var(--color-border)' }} />

      <IntegrationsCard
        onBrowse={() => openDrawer('all')}
        onLanguageSdks={() => openDrawer('languages')}
      />

      <IntegrationsDrawer
        opened={drawerOpened}
        onClose={drawer.close}
        endpoint={endpoint}
        apiKey={apiKey}
        initialCategory={drawerCategory}
      />

      {onCheckTelemetry ? (
        <Group gap={12} align="center">
          <Button
            variant="secondary"
            size="xs"
            onClick={onCheckTelemetry}
            disabled={isChecking}
            leftSection={isChecking ? <Loader size={12} /> : undefined}
          >
            Check for telemetry
          </Button>
          <Text fz={12} style={{ color: 'var(--color-text-muted)' }}>
            Once data is detected your next steps will be ready to use
          </Text>
        </Group>
      ) : null}
    </Stack>
  );
}

export default SendTelemetryPanel;
