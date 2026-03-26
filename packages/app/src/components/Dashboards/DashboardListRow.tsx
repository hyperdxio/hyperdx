import Router from 'next/router';
import { ActionIcon, Badge, Group, Menu, Table, Text } from '@mantine/core';
import { IconDots, IconTrash } from '@tabler/icons-react';

import type { Dashboard } from '../../dashboard';

export function DashboardListRow({
  dashboard,
  onDelete,
}: {
  dashboard: Dashboard;
  onDelete: (id: string) => void;
}) {
  const href = `/dashboards/${dashboard.id}`;

  return (
    <Table.Tr
      style={{ cursor: 'pointer' }}
      onClick={e => {
        if (e.metaKey || e.ctrlKey) {
          window.open(href, '_blank');
        } else {
          Router.push(href);
        }
      }}
      onAuxClick={e => {
        if (e.button === 1) {
          window.open(href, '_blank');
        }
      }}
    >
      <Table.Td>
        <Text fw={500} size="sm">
          {dashboard.name}
        </Text>
      </Table.Td>
      <Table.Td>
        <Group gap={4}>
          {dashboard.tags.map(tag => (
            <Badge key={tag} variant="light" size="xs">
              {tag}
            </Badge>
          ))}
        </Group>
      </Table.Td>
      <Table.Td>
        <Text size="xs" c="dimmed">
          {dashboard.tiles.length}
        </Text>
      </Table.Td>
      <Table.Td>
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon
              variant="secondary"
              size="sm"
              onClick={e => e.stopPropagation()}
            >
              <IconDots size={14} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              color="red"
              leftSection={<IconTrash size={14} />}
              onClick={e => {
                e.stopPropagation();
                onDelete(dashboard.id);
              }}
            >
              Delete
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Table.Td>
    </Table.Tr>
  );
}
