import { Box, Group, Stack, Text, UnstyledButton } from '@mantine/core';

import { LogoBadge } from '@/components/LogoBadge/LogoBadge';

import {
  docUrl,
  hasGuide,
  type IntegrationCategory,
  type IntegrationItem,
} from '../integrationsCatalog';

export function ItemBadge({ item }: { item: IntegrationItem }) {
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

export function CategorySection({
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
