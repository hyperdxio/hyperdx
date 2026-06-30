import { useState } from 'react';
import {
  Box,
  Button,
  CopyButton,
  Group,
  SegmentedControl,
  Stack,
  Text,
} from '@mantine/core';
import { IconCheck, IconCopy, IconSparkles } from '@tabler/icons-react';

import { useBrandDisplayName } from '@/theme/ThemeProvider';

/** Violet accent used to brand the AI setup assistant (theme-agnostic). */
export const AI_ACCENT = '#7c5cff';

export const AI_AGENTS = [
  { label: 'Cursor', value: 'cursor' },
  { label: 'VS Code', value: 'vscode' },
  { label: 'Claude Code', value: 'claude' },
];

function setupPrompt(endpoint: string, apiKey: string, brandName: string) {
  return `Set up ${brandName} / OpenTelemetry observability in this project.

Instrument the application to export logs, traces, and metrics over OTLP/HTTP to:
  endpoint: ${endpoint}
  header:   authorization: ${apiKey}

Add the OpenTelemetry SDK for this project's language/framework, wire up auto-instrumentation, generate any collector config that's needed, then run the app and confirm telemetry is arriving.`;
}

export function AIAgentTab({
  endpoint,
  apiKey,
}: {
  endpoint: string;
  apiKey: string;
}) {
  const [agent, setAgent] = useState('cursor');
  const brandName = useBrandDisplayName();
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
        <CopyButton value={setupPrompt(endpoint, apiKey, brandName)}>
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
