import {
  Box,
  Group,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { IconArrowUpRight } from '@tabler/icons-react';

import { LogoBadge } from '@/components/LogoBadge/LogoBadge';

import {
  docUrl,
  hasGuide,
  type IntegrationCategory,
  type IntegrationItem,
} from './integrationsCatalog';

export function ItemBadge({ item }: { item: IntegrationItem }) {
  return (
    // Brand SVGs are drawn for light backgrounds (several use near-black marks),
    // so keep the tile white in both themes to stay legible.
    <LogoBadge size={44} radius={10} background="#fff">
      {item.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.logo}
          alt=""
          aria-hidden
          style={{ height: 24, width: 'auto', display: 'block' }}
        />
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
    <Tooltip label="Opens the docs in a new tab" withArrow position="top">
      <UnstyledButton
        component="a"
        href={docUrl(item.doc)}
        target="_blank"
        rel="noreferrer"
        style={{ ...TILE_STYLE, position: 'relative' }}
      >
        {label}
        <IconArrowUpRight
          size={13}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            color: 'var(--color-text-muted)',
          }}
        />
      </UnstyledButton>
    </Tooltip>
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
