import {
  ActionIcon,
  Anchor,
  Box,
  CopyButton,
  Divider,
  Group,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconArrowUpRight,
  IconCheck,
  IconCopy,
} from '@tabler/icons-react';

import {
  applyGuideTokens,
  INTEGRATION_GUIDES,
  INTEGRATION_ITEMS_BY_ID,
  SIGNAL_LABELS,
  signalsFor,
} from './integrationsCatalog';
import { ItemBadge } from './ItemTile';

function SignalChip({ label }: { label: string }) {
  return (
    <Box
      px={8}
      py={2}
      style={{
        borderRadius: 999,
        border: '1px solid var(--color-border)',
        background: 'var(--color-bg-muted)',
      }}
    >
      <Text fz={12} fw={500} style={{ color: 'var(--color-text)' }}>
        {label}
      </Text>
    </Box>
  );
}

interface GuideCodeProps {
  code: string;
  endpoint: string;
  apiKey: string;
}

function CodeBlock({ code, endpoint, apiKey }: GuideCodeProps) {
  const resolved = applyGuideTokens(code, endpoint, apiKey);
  return (
    <Box
      style={{
        position: 'relative',
        background: 'var(--color-bg-muted)',
        borderRadius: 8,
      }}
    >
      <Box
        component="pre"
        style={{
          margin: 0,
          padding: '12px 44px 12px 14px',
          fontFamily:
            'var(--mantine-font-family-monospace, ui-monospace, monospace)',
          fontSize: 12.5,
          lineHeight: 1.6,
          color: 'var(--color-text)',
          whiteSpace: 'pre',
          overflowX: 'auto',
        }}
      >
        {resolved}
      </Box>
      <CopyButton value={resolved}>
        {({ copied, copy }) => (
          <Tooltip label={copied ? 'Copied' : 'Copy'} withArrow>
            <ActionIcon
              variant="subtle"
              color="gray"
              onClick={copy}
              style={{ position: 'absolute', top: 6, right: 6 }}
            >
              {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
            </ActionIcon>
          </Tooltip>
        )}
      </CopyButton>
    </Box>
  );
}

export function GuideView({
  guideId,
  endpoint,
  apiKey,
  onBack,
}: {
  guideId: string;
  endpoint: string;
  apiKey: string;
  onBack: () => void;
}) {
  const guide = INTEGRATION_GUIDES[guideId];
  const item = INTEGRATION_ITEMS_BY_ID[guideId];
  const signals = signalsFor(guideId);

  return (
    <Stack gap={16}>
      <UnstyledButton onClick={onBack}>
        <Group gap={6} align="center" wrap="nowrap">
          <IconArrowLeft
            size={15}
            style={{ color: 'var(--color-text-muted)' }}
          />
          <Text fz={13} fw={500} style={{ color: 'var(--color-text-muted)' }}>
            All integrations
          </Text>
        </Group>
      </UnstyledButton>

      <Group gap={12} align="center" wrap="nowrap">
        {item ? <ItemBadge item={item} /> : null}
        <Stack gap={2}>
          <Text fw={700} fz={16} style={{ color: 'var(--color-text)' }}>
            {guide.title}
          </Text>
          <Text fz={12} style={{ color: 'var(--color-text-muted)' }}>
            {guide.steps.length} step
            {guide.steps.length === 1 ? '' : 's'} · copy-paste setup
          </Text>
        </Stack>
      </Group>

      {signals.length > 0 ? (
        <Group gap={8} align="center" wrap="wrap">
          <Text fz={12} fw={500} style={{ color: 'var(--color-text-muted)' }}>
            This guide integrates:
          </Text>
          {signals.map(signal => (
            <SignalChip key={signal} label={SIGNAL_LABELS[signal]} />
          ))}
        </Group>
      ) : null}

      <Divider />

      <Stack gap={18}>
        {guide.steps.map((step, idx) => (
          <Group key={step.title} gap={12} align="flex-start" wrap="nowrap">
            <Box
              style={{
                width: 22,
                height: 22,
                flexShrink: 0,
                borderRadius: 999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--color-text)',
                background: 'var(--color-bg-muted)',
              }}
            >
              {idx + 1}
            </Box>
            <Stack gap={8} style={{ flex: 1, minWidth: 0 }}>
              <Text fz={14} fw={600} style={{ color: 'var(--color-text)' }}>
                {step.title}
              </Text>
              <CodeBlock code={step.code} endpoint={endpoint} apiKey={apiKey} />
            </Stack>
          </Group>
        ))}
      </Stack>

      {guide.docUrl ? (
        <Anchor
          href={guide.docUrl}
          target="_blank"
          rel="noreferrer"
          underline="never"
        >
          <Group gap={6} align="center" wrap="nowrap">
            <Text
              fz={13}
              fw={500}
              style={{
                color: 'var(--click-global-color-text-link-default, #437eef)',
              }}
            >
              View full {guide.title} docs
            </Text>
            <IconArrowUpRight
              size={14}
              style={{
                color: 'var(--click-global-color-text-link-default, #437eef)',
              }}
            />
          </Group>
        </Anchor>
      ) : null}
    </Stack>
  );
}
