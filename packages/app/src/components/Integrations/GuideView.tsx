import {
  Anchor,
  Box,
  Group,
  Loader,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconArrowUpRight,
  IconInfoCircle,
} from '@tabler/icons-react';

import { ConnectionSnippet } from './ConnectionSnippet';
import { IntegrationDocMarkdown } from './IntegrationDocMarkdown';
import {
  docUrl,
  docUrlFromSlug,
  INTEGRATION_ITEMS_BY_ID,
  SIGNAL_LABELS,
  signalsFor,
} from './integrationsCatalog';
import { ItemBadge } from './ItemTile';
import { useIntegrationDoc } from './useIntegrationDoc';

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

/**
 * Callout that tells the user the snippets use the docs' placeholder endpoint /
 * ingestion key, and to swap in the real values shown in the Connection panel
 * above. We deliberately render the docs verbatim rather than substituting the
 * values into the code, so the guide always matches upstream.
 */
function ReplaceTokensNote() {
  return (
    <Group
      gap={8}
      align="flex-start"
      wrap="nowrap"
      p={10}
      style={{
        borderRadius: 8,
        border: '1px solid var(--color-border)',
        background: 'var(--color-bg-muted)',
      }}
    >
      <IconInfoCircle
        size={16}
        style={{
          color: 'var(--color-text-muted)',
          flexShrink: 0,
          marginTop: 1,
        }}
      />
      <Text fz={12.5} style={{ color: 'var(--color-text-muted)' }}>
        The snippets below come straight from the docs and use placeholder
        values. Replace the endpoint and ingestion key with the values from the{' '}
        <Text component="span" fw={600} style={{ color: 'var(--color-text)' }}>
          Connection
        </Text>{' '}
        panel above.
      </Text>
    </Group>
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
  const item = INTEGRATION_ITEMS_BY_ID[guideId];
  const signals = signalsFor(guideId);
  const { data, isLoading, isError, refetch } = useIntegrationDoc(item);

  const title = data?.title || item?.name || guideId;
  const fullDocsUrl = data?.slug
    ? docUrlFromSlug(data.slug)
    : item
      ? docUrl(item.doc)
      : null;

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
            {title}
          </Text>
          <Text fz={12} style={{ color: 'var(--color-text-muted)' }}>
            Setup guide · from the ClickStack docs
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

      <ConnectionSnippet endpoint={endpoint} apiKey={apiKey} />
      <ReplaceTokensNote />

      {isLoading ? (
        <Group gap={8} align="center" py="xl" justify="center">
          <Loader size="sm" />
          <Text fz={13} style={{ color: 'var(--color-text-muted)' }}>
            Loading setup guide…
          </Text>
        </Group>
      ) : isError || !data ? (
        <Stack gap={8} align="center" py="lg">
          <Text fz={13} style={{ color: 'var(--color-text-muted)' }}>
            Couldn’t load the setup guide.
          </Text>
          <UnstyledButton onClick={() => refetch()}>
            <Text
              fz={13}
              fw={500}
              style={{
                color: 'var(--click-global-color-text-link-default, #437eef)',
              }}
            >
              Try again
            </Text>
          </UnstyledButton>
        </Stack>
      ) : (
        <IntegrationDocMarkdown body={data.body} />
      )}

      {fullDocsUrl ? (
        <Anchor
          href={fullDocsUrl}
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
              View full {title} docs
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
