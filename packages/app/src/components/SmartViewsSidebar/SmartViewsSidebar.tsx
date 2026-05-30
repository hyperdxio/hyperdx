import { useCallback } from 'react';
import { SmartViewResource } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Box,
  Button,
  Group,
  Menu,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDots, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';

import { type SmartView, useDeleteSmartView, useSmartViews } from '@/smartView';
import { useConfirm } from '@/useConfirm';

export function SmartViewsSidebar({
  resource,
  activeId,
  onActivate,
  onCreate,
  onEdit,
}: {
  resource: SmartViewResource;
  activeId: string | null;
  onActivate: (id: string | null) => void;
  onCreate: () => void;
  onEdit: (view: SmartView) => void;
}) {
  const { data: views, isLoading } = useSmartViews(resource);
  const deleteSmartView = useDeleteSmartView();
  const confirm = useConfirm();

  const handleDelete = useCallback(
    async (view: SmartView) => {
      const confirmed = await confirm(
        `Delete the "${view.name}" smart view? This action cannot be undone.`,
        'Delete',
        { variant: 'danger' },
      );
      if (!confirmed) return;
      deleteSmartView.mutate(
        { id: view.id, resource: view.resource },
        {
          onSuccess: () => {
            if (activeId === view.id) {
              onActivate(null);
            }
            notifications.show({
              message: 'Smart view deleted',
              color: 'green',
            });
          },
          onError: () => {
            notifications.show({
              message: 'Failed to delete smart view',
              color: 'red',
            });
          },
        },
      );
    },
    [activeId, confirm, deleteSmartView, onActivate],
  );

  return (
    <Box w={240} data-testid="smart-views-sidebar">
      <Group justify="space-between" mb="xs">
        <Text fw={500} size="sm" c="dimmed">
          Smart Views
        </Text>
        <ActionIcon
          variant="subtle"
          size="sm"
          onClick={onCreate}
          aria-label="New smart view"
          data-testid="new-smart-view-button"
        >
          <IconPlus size={16} />
        </ActionIcon>
      </Group>

      {isLoading ? (
        <Text size="xs" c="dimmed">
          Loading...
        </Text>
      ) : !views || views.length === 0 ? (
        <Stack gap="xs">
          <Text size="xs" c="dimmed">
            No smart views yet. Pin a tag filter combination to jump back to it.
          </Text>
          <Button
            variant="subtle"
            size="xs"
            leftSection={<IconPlus size={14} />}
            onClick={onCreate}
            data-testid="new-smart-view-empty-button"
          >
            New Smart View
          </Button>
        </Stack>
      ) : (
        <Stack gap={4}>
          {views.map(view => {
            const isActive = view.id === activeId;
            return (
              <Group
                key={view.id}
                wrap="nowrap"
                gap={4}
                data-active={isActive || undefined}
                data-testid={`smart-view-row-${view.id}`}
              >
                <UnstyledButton
                  onClick={() => onActivate(isActive ? null : view.id)}
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    borderRadius: 4,
                    backgroundColor: isActive
                      ? 'var(--mantine-color-default-hover)'
                      : undefined,
                  }}
                  aria-pressed={isActive}
                >
                  <Group gap={6} wrap="nowrap">
                    {view.icon && (
                      <Text size="sm" component="span">
                        {view.icon}
                      </Text>
                    )}
                    <Text
                      size="sm"
                      fw={isActive ? 600 : 400}
                      lineClamp={1}
                      style={{ flex: 1, minWidth: 0 }}
                    >
                      {view.name}
                    </Text>
                  </Group>
                </UnstyledButton>
                <Menu position="bottom-end" withinPortal>
                  <Menu.Target>
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      aria-label={`Smart view "${view.name}" menu`}
                      data-testid={`smart-view-menu-${view.id}`}
                    >
                      <IconDots size={14} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item
                      leftSection={<IconPencil size={14} />}
                      onClick={() => onEdit(view)}
                    >
                      Edit
                    </Menu.Item>
                    <Menu.Item
                      leftSection={<IconTrash size={14} />}
                      color="red"
                      onClick={() => handleDelete(view)}
                    >
                      Delete
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </Group>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
