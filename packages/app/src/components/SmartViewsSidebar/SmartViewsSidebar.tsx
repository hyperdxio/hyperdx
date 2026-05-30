import { useCallback } from 'react';
import { SmartViewResource } from '@hyperdx/common-utils/dist/types';
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

import { type SmartView, useDeleteSmartView, useSmartViews } from '@/smartView';
import { useConfirm } from '@/useConfirm';

const ALL_VIEW_LABEL: Record<SmartViewResource, string> = {
  dashboard: 'All Dashboards',
  savedSearch: 'All Saved Searches',
};

export function SmartViewsSidebar({
  resource,
  activeId,
  onActivate,
  onCreate,
  onEdit,
  totalCount,
  viewCounts,
}: {
  resource: SmartViewResource;
  activeId: string | null;
  onActivate: (id: string | null) => void;
  onCreate: () => void;
  onEdit: (view: SmartView) => void;
  /** Total number of items in the listing, shown next to the
   *  default "All ..." entry. */
  totalCount: number;
  /** Pre-computed match count per view id. Keeps the sidebar a
   *  pure presentation layer; the parent owns the evaluator call
   *  so the same `dashboards` reference drives the grid and the
   *  badges in lockstep. */
  viewCounts: Record<string, number>;
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

  const hasViews = (views?.length ?? 0) > 0;

  return (
    <Box w={220} data-testid="smart-views-sidebar">
      <Stack gap={2}>
        <SidebarEntry
          label={ALL_VIEW_LABEL[resource]}
          count={totalCount}
          isActive={activeId == null}
          onClick={() => onActivate(null)}
          testId="smart-view-row-all"
        />

        <Group justify="space-between" align="center" mt="md" mb={4} px="sm">
          <Text size="xs" fw={600} c="dimmed" tt="uppercase" lts={0.4}>
            Smart Views
          </Text>
          <ActionIcon
            variant="subtle"
            size="xs"
            onClick={onCreate}
            aria-label="New smart view"
            data-testid="new-smart-view-button"
          >
            <IconPlus size={12} />
          </ActionIcon>
        </Group>

        {isLoading ? (
          <Text size="xs" c="dimmed" px="sm" py={4}>
            Loading...
          </Text>
        ) : !hasViews ? (
          // Quiet empty state: no nag copy, just a single affordance
          // sized to match a row. The "+" header above is the primary
          // way in; this is a fallback for users who don't notice it.
          <UnstyledButton
            onClick={onCreate}
            data-testid="new-smart-view-empty-button"
            style={{
              padding: '6px 10px',
              borderRadius: 4,
              color: 'var(--mantine-color-dimmed)',
              fontSize: 13,
            }}
          >
            + New Smart View
          </UnstyledButton>
        ) : (
          views!.map(view => (
            <SidebarEntry
              key={view.id}
              label={view.name}
              icon={view.icon}
              count={viewCounts[view.id]}
              isActive={view.id === activeId}
              onClick={() => onActivate(view.id === activeId ? null : view.id)}
              testId={`smart-view-row-${view.id}`}
              menu={
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
