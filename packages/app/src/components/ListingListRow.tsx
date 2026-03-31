import Router from 'next/router';
import { ActionIcon, Badge, Group, Menu, Table, Text } from '@mantine/core';
import { IconDots, IconTrash } from '@tabler/icons-react';

export function ListingRow({
  id,
  name,
  href,
  tags,
  onDelete,
  leftSection,
}: {
  id: string;
  name: string;
  href: string;
  tags?: string[];
  onDelete?: (id: string) => void;
  leftSection?: React.ReactNode;
}) {
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
      {leftSection != null && <Table.Td px={0}>{leftSection}</Table.Td>}
      <Table.Td>
        <Group gap={4} wrap="nowrap">
          <Text fw={500} size="sm" maw={500} truncate="end">
            {name}
          </Text>
        </Group>
      </Table.Td>
      <Table.Td>
        <Group gap={4}>
          {tags?.map(tag => (
            <Badge key={tag} variant="light" size="xs">
              {tag}
            </Badge>
          ))}
        </Group>
      </Table.Td>
      <Table.Td>
        {onDelete && (
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
                  onDelete(id);
                }}
              >
                Delete
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      </Table.Td>
    </Table.Tr>
  );
}
