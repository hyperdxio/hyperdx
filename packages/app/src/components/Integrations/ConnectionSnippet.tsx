import { useState } from 'react';
import {
  ActionIcon,
  Box,
  CopyButton,
  Group,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { IconCheck, IconCopy, IconEye, IconEyeOff } from '@tabler/icons-react';

const MASKED_KEY = '••••••••••••••••';

function snippet(endpoint: string, key: string) {
  return `endpoint: ${endpoint}\napi-key:  ${key}`;
}

/**
 * Compact connection card shown at the top of the integrations drawer: the
 * OTLP endpoint + ingestion key the user points their SDK at. Mirrors the
 * "URL" view of the send-telemetry connection panel (reveal-key toggle + copy),
 * scoped to just the endpoint/key that's relevant when picking an integration.
 */
export function ConnectionSnippet({
  endpoint,
  apiKey,
}: {
  endpoint: string;
  apiKey: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const display = snippet(endpoint, revealed ? apiKey : MASKED_KEY);
  const copyText = snippet(endpoint, apiKey);

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
        <Text fz={12} fw={600} style={{ color: 'var(--color-text-muted)' }}>
          Connection
        </Text>
        <UnstyledButton onClick={() => setRevealed(r => !r)}>
          <Group gap={6} align="center" wrap="nowrap">
            {revealed ? (
              <IconEyeOff
                size={15}
                style={{ color: 'var(--color-text-muted)' }}
              />
            ) : (
              <IconEye size={15} style={{ color: 'var(--color-text-muted)' }} />
            )}
            <Text fz={12} fw={500} style={{ color: 'var(--color-text-muted)' }}>
              {revealed ? 'Hide key' : 'Reveal key'}
            </Text>
          </Group>
        </UnstyledButton>
      </Group>

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
    </Box>
  );
}
