import { ReactNode } from 'react';
import { ActionIcon, Box, ColorSwatch, Group, Menu, Text } from '@mantine/core';
import { IconDotsVertical } from '@tabler/icons-react';

/**
 * Presentational chrome for one chart series: color, name, alias, overflow
 * menu, and a fields slot. Shared by Explore and the tile editor.
 */
export function SeriesCard({
  index,
  color,
  onColorClick,
  title,
  titleExtra,
  aliasSlot,
  menu,
  children,
  testId = 'series-card',
}: {
  index: number;
  color: string;
  onColorClick?: () => void;
  title?: string;
  titleExtra?: ReactNode;
  aliasSlot: ReactNode;
  menu: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  const name = title ?? `Series ${index + 1}`;
  return (
    <Box
      p="xs"
      data-testid={testId}
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--mantine-radius-default)',
        background: 'var(--color-bg-surface, transparent)',
      }}
    >
      <Group justify="space-between" mb="xs" wrap="nowrap" gap="xs">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <ColorSwatch
            color={color}
            size={12}
            onClick={onColorClick}
            style={onColorClick ? { cursor: 'pointer' } : undefined}
            aria-label={onColorClick ? `Edit ${name} color` : `${name} color`}
          />
          <Text size="sm" fw={500} truncate>
            {name}
          </Text>
          {titleExtra}
        </Group>
        <Group gap="xs" wrap="nowrap">
          {aliasSlot}
          {menu}
        </Group>
      </Group>
      {children}
    </Box>
  );
}

export function SeriesCardMenu({
  children,
  ariaLabel = 'Series actions',
}: {
  children: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <Menu width={200} withinPortal={false} position="bottom-end">
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          size="sm"
          aria-label={ariaLabel}
          data-testid="series-actions-menu"
        >
          <IconDotsVertical size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>{children}</Menu.Dropdown>
    </Menu>
  );
}

export function SeriesAliasField({ children }: { children: ReactNode }) {
  return (
    <Group gap={6} wrap="nowrap">
      <Text size="xs" c="dimmed">
        Alias
      </Text>
      {children}
    </Group>
  );
}
