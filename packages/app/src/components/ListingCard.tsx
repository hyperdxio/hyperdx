import Link from 'next/link';
import { ActionIcon, Badge, Card, Group, Menu, Text } from '@mantine/core';
import { IconDots, IconTrash } from '@tabler/icons-react';

import { FavoriteButton } from '@/components/FavoriteButton';
import { Favorite } from '@/favorites';

export function ListingCard({
  name,
  href,
  description,
  tags,
  onDelete,
  statusIcon,
  resourceId,
  resourceType,
}: {
  name: string;
  href: string;
  description?: string;
  tags?: string[];
  onDelete?: () => void;
  statusIcon?: React.ReactNode;
  resourceId?: string;
  resourceType?: Favorite['resourceType'];
}) {
  return (
    <Card
      component={Link}
      href={href}
      withBorder
      padding="lg"
      radius="sm"
      style={{ cursor: 'pointer', textDecoration: 'none' }}
    >
      <Group justify="space-between" mb="xs" wrap="nowrap">
        <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          <Text
            fw={500}
            lineClamp={1}
            style={{ flex: 1, minWidth: 0 }}
            title={name}
          >
            {name}
          </Text>
          {statusIcon}
          {resourceId && resourceType && (
            <FavoriteButton
              resourceType={resourceType}
              resourceId={resourceId}
              size="xs"
            />
          )}
        </Group>
        {onDelete && (
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon
                variant="secondary"
                size="sm"
                onClick={e => e.preventDefault()}
              >
                <IconDots size={14} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                color="red"
                leftSection={<IconTrash size={14} />}
                onClick={e => {
                  e.preventDefault();
                  onDelete();
                }}
              >
                Delete
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>

      {description && (
        <Text size="sm" c="dimmed">
          {description}
        </Text>
      )}

      {tags && tags.length > 0 && (
        <Group gap="xs" mt="xs">
          {tags.map(tag => (
            <Badge key={tag} variant="light" size="xs">
              {tag}
            </Badge>
          ))}
        </Group>
      )}
    </Card>
  );
}
