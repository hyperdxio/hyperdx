import { useMemo, useState } from 'react';
import {
  Anchor,
  Group,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import {
  IconArrowUpRight,
  IconExternalLink,
  IconSearch,
} from '@tabler/icons-react';

import { ConnectionSnippet } from './ConnectionSnippet';
import { GuideView } from './GuideView';
import {
  docUrl,
  INTEGRATION_CATEGORIES,
  type IntegrationItem,
} from './integrationsCatalog';
import { CategorySection } from './ItemTile';

const CHIPS = [
  { id: 'all', label: 'All' },
  ...INTEGRATION_CATEGORIES.map(c => ({ id: c.id, label: c.label })),
];

function matchesQuery(item: IntegrationItem, query: string) {
  if (!query) return true;
  const haystack = [item.name, ...(item.keywords ?? [])]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

/**
 * Stateful drawer body. Lives as a separate component so it (re)mounts whenever
 * the drawer opens — Mantine `Drawer` doesn't render children while closed —
 * which resets the search/category filters to the requested entry point without
 * an effect.
 */
export function DrawerContent({
  endpoint,
  apiKey,
  initialCategory,
}: {
  endpoint: string;
  apiKey: string;
  initialCategory: string;
}) {
  const [query, setQuery] = useState('');
  const [activeChip, setActiveChip] = useState(initialCategory);
  const [guideId, setGuideId] = useState<string | null>(null);

  const visibleCategories = useMemo(() => {
    return INTEGRATION_CATEGORIES.filter(
      cat => activeChip === 'all' || cat.id === activeChip,
    )
      .map(cat => ({
        ...cat,
        items: cat.items.filter(item => matchesQuery(item, query)),
      }))
      .filter(cat => cat.items.length > 0);
  }, [activeChip, query]);

  if (guideId) {
    return (
      <GuideView
        guideId={guideId}
        endpoint={endpoint}
        apiKey={apiKey}
        onBack={() => setGuideId(null)}
      />
    );
  }

  return (
    <Stack gap={16}>
      <ConnectionSnippet endpoint={endpoint} apiKey={apiKey} />

      <TextInput
        value={query}
        onChange={e => setQuery(e.currentTarget.value)}
        placeholder="Search integrations…"
        leftSection={<IconSearch size={16} />}
      />

      <Group gap={8}>
        {CHIPS.map(chip => {
          const active = chip.id === activeChip;
          return (
            <UnstyledButton
              key={chip.id}
              onClick={() => setActiveChip(chip.id)}
              style={{
                padding: '5px 12px',
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 500,
                color: active
                  ? 'var(--color-text-inverted)'
                  : 'var(--color-text)',
                background: active
                  ? 'var(--color-text)'
                  : 'var(--color-bg-muted)',
              }}
            >
              {chip.label}
            </UnstyledButton>
          );
        })}
      </Group>

      {visibleCategories.length > 0 ? (
        <Stack gap={24}>
          {visibleCategories.map(cat => (
            <CategorySection
              key={cat.id}
              category={cat}
              onOpenGuide={setGuideId}
            />
          ))}
        </Stack>
      ) : (
        <Group gap={8} align="center" py="xl" justify="center">
          <IconSearch size={16} style={{ color: 'var(--color-text-muted)' }} />
          <Text fz={14} style={{ color: 'var(--color-text-muted)' }}>
            No integrations match “{query}”.
          </Text>
        </Group>
      )}

      <Anchor
        href={docUrl('ingesting-data')}
        target="_blank"
        rel="noreferrer"
        underline="never"
      >
        <Group gap={6} align="center" wrap="nowrap">
          <IconExternalLink
            size={14}
            style={{ color: 'var(--color-text-muted)' }}
          />
          <Text fz={13} fw={500} style={{ color: 'var(--color-text-muted)' }}>
            Browse all ingestion options
          </Text>
          <IconArrowUpRight
            size={14}
            style={{ color: 'var(--color-text-muted)' }}
          />
        </Group>
      </Anchor>
    </Stack>
  );
}
