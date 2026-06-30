import { useMemo, useState } from 'react';
import {
  ActionIcon,
  Anchor,
  Box,
  CopyButton,
  Divider,
  Drawer,
  Group,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconArrowUpRight,
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconSearch,
} from '@tabler/icons-react';

import { LogoBadge } from '@/components/LogoBadge/LogoBadge';

import {
  applyGuideTokens,
  docUrl,
  hasGuide,
  INTEGRATION_CATEGORIES,
  INTEGRATION_GUIDES,
  INTEGRATION_ITEMS_BY_ID,
  type IntegrationCategory,
  type IntegrationItem,
} from './integrationsCatalog';

function ItemBadge({ item }: { item: IntegrationItem }) {
  const { Icon } = item;
  return (
    <LogoBadge size={44} radius={10}>
      {Icon ? (
        <Icon size={24} color={item.color} />
      ) : (
        <Text fw={700} fz={14} style={{ color: item.color ?? 'inherit' }}>
          {item.monogram}
        </Text>
      )}
    </LogoBadge>
  );
}

const TILE_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  padding: '16px 8px',
  borderRadius: 10,
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg-surface)',
} as const;

function ItemTile({
  item,
  onOpenGuide,
}: {
  item: IntegrationItem;
  onOpenGuide: (id: string) => void;
}) {
  const label = (
    <>
      <ItemBadge item={item} />
      <Text fz={13} fw={500} ta="center" style={{ color: 'var(--color-text)' }}>
        {item.name}
      </Text>
    </>
  );

  // Items with an inline guide open the in-drawer setup steps; the rest deep
  // link to their docs page.
  if (hasGuide(item.id)) {
    return (
      <UnstyledButton onClick={() => onOpenGuide(item.id)} style={TILE_STYLE}>
        {label}
      </UnstyledButton>
    );
  }

  return (
    <UnstyledButton
      component="a"
      href={docUrl(item.doc)}
      target="_blank"
      rel="noreferrer"
      style={TILE_STYLE}
    >
      {label}
    </UnstyledButton>
  );
}

function CategorySection({
  category,
  onOpenGuide,
}: {
  category: IntegrationCategory;
  onOpenGuide: (id: string) => void;
}) {
  return (
    <Stack gap={12}>
      <Group gap={8} align="center">
        <Text fz={13} fw={600} style={{ color: 'var(--color-text)' }}>
          {category.label}
        </Text>
        <Text fz={12} style={{ color: 'var(--color-text-muted)' }}>
          {category.items.length}
        </Text>
      </Group>
      <Box
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
        }}
      >
        {category.items.map(item => (
          <ItemTile key={item.id} item={item} onOpenGuide={onOpenGuide} />
        ))}
      </Box>
    </Stack>
  );
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

interface GuideCodeProps {
  code: string;
  endpoint: string;
  apiKey: string;
}

function GuideView({
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

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <Group
      gap={10}
      wrap="nowrap"
      align="center"
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        padding: '8px 8px 8px 12px',
        background: 'var(--color-bg-surface)',
      }}
    >
      <Text fz={12} fw={500} style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </Text>
      <Text
        fz={12}
        ff="var(--mantine-font-family-monospace, ui-monospace, monospace)"
        truncate
        style={{ color: 'var(--color-text)', flex: 1 }}
      >
        {value}
      </Text>
      <CopyButton value={value}>
        {({ copied, copy }) => (
          <Tooltip label={copied ? 'Copied' : 'Copy'} withArrow>
            <ActionIcon variant="subtle" color="gray" onClick={copy}>
              {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
            </ActionIcon>
          </Tooltip>
        )}
      </CopyButton>
    </Group>
  );
}

const CHIPS = [
  { id: 'all', label: 'All' },
  ...INTEGRATION_CATEGORIES.map(c => ({ id: c.id, label: c.label })),
];

export interface IntegrationsDrawerProps {
  opened: boolean;
  onClose: () => void;
  endpoint: string;
  apiKey: string;
  /** Category chip selected when the drawer opens. */
  initialCategory?: string;
}

function matchesQuery(item: IntegrationItem, query: string) {
  if (!query) return true;
  const haystack = [item.name, ...(item.keywords ?? [])]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

const TOTAL_COUNT = INTEGRATION_CATEGORIES.reduce(
  (sum, c) => sum + c.items.length,
  0,
);

/**
 * Stateful drawer body. Lives as a separate component so it (re)mounts whenever
 * the drawer opens — Mantine `Drawer` doesn't render children while closed —
 * which resets the search/category filters to the requested entry point without
 * an effect.
 */
function DrawerContent({
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
      <Stack gap={8}>
        <CopyRow label="Endpoint" value={endpoint} />
        <CopyRow label="Ingestion key" value={apiKey} />
      </Stack>

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

export function IntegrationsDrawer({
  opened,
  onClose,
  endpoint,
  apiKey,
  initialCategory = 'all',
}: IntegrationsDrawerProps) {
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size={640}
      title={
        <Stack gap={2}>
          <Group gap={8} align="center">
            <Text fw={700} fz={18} style={{ color: 'var(--color-text)' }}>
              Send data to ClickStack
            </Text>
            <Box
              px={8}
              style={{
                borderRadius: 999,
                background: 'var(--color-bg-muted)',
              }}
            >
              <Text fz={12} fw={600} style={{ color: 'var(--color-text)' }}>
                {TOTAL_COUNT}
              </Text>
            </Box>
          </Group>
          <Text fz={13} style={{ color: 'var(--color-text-muted)' }}>
            Pick a language, framework, or platform to get a setup guide.
          </Text>
        </Stack>
      }
    >
      <DrawerContent
        endpoint={endpoint}
        apiKey={apiKey}
        initialCategory={initialCategory}
      />
    </Drawer>
  );
}
