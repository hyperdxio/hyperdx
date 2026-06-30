import { useState } from 'react';
import {
  ActionIcon,
  Box,
  CopyButton,
  Group,
  SegmentedControl,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconCheck,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconSparkles,
} from '@tabler/icons-react';

import { AI_ACCENT, AIAgentTab } from './AIAgentTab';

const MASKED_KEY = '••••••••••••••••••••••••';

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

export function ConnectionPanel({
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
