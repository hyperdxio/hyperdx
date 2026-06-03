import { useCallback } from 'react';
import { ListViewResource } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Box,
  Group,
  Menu,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDots, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';

import { type ListView, useDeleteListView, useListViews } from '@/listView';
import { useConfirm } from '@/useConfirm';
import { getDefaultListViews } from '@/utils/defaultListViews';

const ALL_VIEW_LABEL: Record<ListViewResource, string> = {
  dashboard: 'All Dashboards',
  savedSearch: 'All Saved Searches',
};

export function ListViewsSidebar({
  resource,
  activeId,
  onActivate,
  onCreate,
  onEdit,
  totalCount,
  viewCounts,
}: {
  resource: ListViewResource;
  activeId: string | null;
  onActivate: (id: string | null) => void;
  onCreate: () => void;
  onEdit: (view: ListView) => void;
  /** Total number of items in the listing, shown next to the
   *  default "All ..." entry. */
  totalCount: number;
  /** Pre-computed match count per view id. Keeps the sidebar a
   *  pure presentation layer; the parent owns the evaluator call
   *  so the same `dashboards` reference drives the grid and the
   *  badges in lockstep. */
  viewCounts: Record<string, number>;
}) {
  const { data: views, isLoading } = useListViews(resource);
  const deleteListView = useDeleteListView();
  const confirm = useConfirm();

  const handleDelete = useCallback(
    async (view: ListView) => {
      const confirmed = await confirm(
        `Delete the "${view.name}" view? This action cannot be undone.`,
        'Delete',
        { variant: 'danger' },
      );
      if (!confirmed) return;
      deleteListView.mutate(
        { id: view.id, resource: view.resource },
        {
          onSuccess: () => {
            if (activeId === view.id) {
              onActivate(null);
            }
            notifications.show({
              message: 'View deleted',
              color: 'green',
            });
          },
          onError: () => {
            notifications.show({
              message: 'Failed to delete view',
              color: 'red',
            });
          },
        },
      );
    },
    [activeId, confirm, deleteListView, onActivate],
  );

  const hasViews = (views?.length ?? 0) > 0;
  const systemViews = getDefaultListViews(resource);

  return (
    <Box w={220} data-testid="list-views-sidebar">
      <Stack gap={2}>
        <SidebarEntry
          label={ALL_VIEW_LABEL[resource]}
          count={totalCount}
          isActive={activeId == null}
          onClick={() => onActivate(null)}
          testId="list-view-row-all"
        />

        <Text
          size="xs"
          fw={600}
          c="dimmed"
          tt="uppercase"
          lts={0.4}
          mt="md"
          mb={4}
          px="sm"
        >
          Suggested
        </Text>
        {systemViews.map(view => (
          <SidebarEntry
            key={view.id}
            label={view.name}
            icon={view.icon}
            count={viewCounts[view.id]}
            isActive={view.id === activeId}
            onClick={() => onActivate(view.id === activeId ? null : view.id)}
            testId={`list-view-row-${view.id}`}
          />
        ))}

        <Group justify="space-between" align="center" mt="md" mb={4} px="sm">
          <Text size="xs" fw={600} c="dimmed" tt="uppercase" lts={0.4}>
            Your views
          </Text>
          {/*
            The primary "save a view" entry now lives next to the
            filter chips on the listing (filters-first flow). The
            kebab here is the secondary path to the advanced editor
            drawer for hand-written rule lists.
          */}
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon
                variant="subtle"
                size="xs"
                aria-label="Views section menu"
                data-testid="list-views-section-menu"
              >
                <IconDots size={12} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconPlus size={14} />}
                onClick={onCreate}
                data-testid="new-list-view-button"
              >
                New view (advanced)
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>

        {isLoading ? (
          <Text size="xs" c="dimmed" px="sm" py={4}>
            Loading...
          </Text>
        ) : !hasViews ? (
          <Text size="xs" c="dimmed" px="sm" py={4}>
            Save your active filters as a view to pin it here.
          </Text>
        ) : (
          views!.map(view => (
            <SidebarEntry
              key={view.id}
              label={view.name}
              icon={view.icon}
              count={viewCounts[view.id]}
              isActive={view.id === activeId}
              onClick={() => onActivate(view.id === activeId ? null : view.id)}
              testId={`list-view-row-${view.id}`}
              menu={
                <Menu position="bottom-end" withinPortal>
                  <Menu.Target>
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      aria-label={`View "${view.name}" menu`}
                      data-testid={`list-view-menu-${view.id}`}
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
              }
            />
          ))
        )}
      </Stack>
    </Box>
  );
}

function SidebarEntry({
  label,
  icon,
  count,
  isActive,
  onClick,
  menu,
  testId,
}: {
  label: string;
  icon?: string;
  count?: number;
  isActive: boolean;
  onClick: () => void;
  menu?: React.ReactNode;
  testId: string;
}) {
  return (
    <Group
      gap={0}
      wrap="nowrap"
      data-active={isActive || undefined}
      data-testid={testId}
      style={{
        borderRadius: 4,
        position: 'relative',
        backgroundColor: isActive
          ? 'var(--mantine-color-default-hover)'
          : undefined,
        // Left accent bar mirrors AppNav's active state and gives the
        // catalog rail a clear "you are here" indicator at a glance.
        boxShadow: isActive
          ? 'inset 3px 0 0 var(--color-text-brand)'
          : undefined,
      }}
    >
      <UnstyledButton
        onClick={onClick}
        aria-pressed={isActive}
        style={{
          flex: 1,
          padding: '6px 10px',
          minWidth: 0,
        }}
      >
        <Group gap={6} wrap="nowrap">
          {icon && (
            <Text size="sm" component="span" style={{ flexShrink: 0 }}>
              {icon}
            </Text>
          )}
          <Text
            size="sm"
            fw={isActive ? 600 : 500}
            lineClamp={1}
            style={{ flex: 1, minWidth: 0 }}
            c={isActive ? undefined : 'var(--mantine-color-text)'}
          >
            {label}
          </Text>
          {typeof count === 'number' && (
            <Text
              size="xs"
              c="dimmed"
              style={{
                fontVariantNumeric: 'tabular-nums',
                flexShrink: 0,
              }}
            >
              {count}
            </Text>
          )}
        </Group>
      </UnstyledButton>
      {menu}
    </Group>
  );
}
