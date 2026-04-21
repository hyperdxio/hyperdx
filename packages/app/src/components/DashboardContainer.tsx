import { useState } from 'react';
import { DashboardContainer as DashboardContainerSchema } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Box,
  Button,
  Flex,
  Group,
  Menu,
  Modal,
  Tabs,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import {
  IconChevronRight,
  IconDotsVertical,
  IconGripVertical,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';

import { type DragHandleProps } from '@/components/DashboardDndContext';
import GroupTabBar, { AlertDot } from '@/components/GroupTabBar';

type DashboardContainerProps = {
  container: DashboardContainerSchema;
  collapsed: boolean;
  defaultCollapsed: boolean;
  onToggle: () => void;
  onToggleDefaultCollapsed?: () => void;
  onToggleCollapsible?: () => void;
  onToggleBordered?: () => void;
  onDelete?: (action: 'ungroup' | 'delete') => void;
  /** Tile count inside this container — determines whether "Ungroup Tiles" is offered. */
  tileCount?: number;
  onAddTile?: () => void;
  activeTabId?: string;
  onTabChange?: (tabId: string) => void;
  onAddTab?: () => void;
  onRenameTab?: (tabId: string, newTitle: string) => void;
  onDeleteTab?: (tabId: string, action: 'delete' | 'move') => void;
  onRename?: (newTitle: string) => void;
  children: (activeTabId: string | undefined) => React.ReactNode;
  dragHandleProps?: DragHandleProps;
  /** Tab IDs that contain tiles with active alerts */
  alertingTabIds?: Set<string>;
};

export default function DashboardContainer({
  container,
  collapsed,
  defaultCollapsed,
  onToggle,
  onToggleDefaultCollapsed,
  onToggleCollapsible,
  onToggleBordered,
  onDelete,
  tileCount = 0,
  onAddTile,
  activeTabId,
  onTabChange,
  onAddTab,
  onRenameTab,
  onDeleteTab,
  onRename,
  children,
  dragHandleProps,
  alertingTabIds,
}: DashboardContainerProps) {
  const [isRenamingGroup, setIsRenamingGroup] = useState(false);
  const [groupRenameValue, setGroupRenameValue] = useState(container.title);
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const tabs = container.tabs ?? [];
  const hasTabs = tabs.length >= 2;
  const collapsible = container.collapsible !== false;
  const bordered = container.bordered !== false;
  const showControls = hovered || menuOpen;
  const resolvedActiveTabId = activeTabId ?? tabs[0]?.id;
  const isCollapsed = collapsible && collapsed;

  const firstTab = tabs[0];
  const headerTitle = firstTab?.title ?? container.title;

  const handleSaveGroupRename = () => {
    const trimmed = groupRenameValue.trim();
    if (trimmed && trimmed !== headerTitle) {
      if (firstTab) {
        onRenameTab?.(firstTab.id, trimmed);
      } else {
        onRename?.(trimmed);
      }
    } else {
      setGroupRenameValue(headerTitle);
    }
    setIsRenamingGroup(false);
  };

  // Visibility style for controls that appear on hover
  const hoverControlStyle = {
    opacity: showControls ? 1 : 0,
    pointerEvents: (showControls
      ? 'auto'
      : 'none') as React.CSSProperties['pointerEvents'],
  };

  const chevron = collapsible ? (
    <IconChevronRight
      role="button"
      tabIndex={0}
      aria-expanded={!isCollapsed}
      aria-label={isCollapsed ? 'Expand group' : 'Collapse group'}
      size={16}
      style={{
        transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
        transition: 'transform 150ms ease',
        flexShrink: 0,
        color: 'var(--color-text-muted)',
        cursor: 'pointer',
      }}
      onClick={onToggle}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle?.();
        }
      }}
      data-testid={`group-chevron-${container.id}`}
    />
  ) : null;

  const addTileButton = !isCollapsed && onAddTile && (
    <Tooltip label="Add Tile" position="top" withArrow>
      <ActionIcon
        variant="subtle"
        size="sm"
        tabIndex={showControls ? 0 : -1}
        style={hoverControlStyle}
        onClick={onAddTile}
        data-testid={`group-add-tile-${container.id}`}
      >
        <IconPlus size={14} />
      </ActionIcon>
    </Tooltip>
  );

  const overflowMenu = (
    <Menu width={200} position="bottom-end" onChange={setMenuOpen}>
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          size="sm"
          tabIndex={showControls ? 0 : -1}
          style={hoverControlStyle}
          data-testid={`group-menu-${container.id}`}
        >
          <IconDotsVertical size={14} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {onAddTab && (
          <Menu.Item leftSection={<IconPlus size={14} />} onClick={onAddTab}>
            Add Tab
          </Menu.Item>
        )}
        {(onToggleCollapsible ||
          onToggleBordered ||
          onToggleDefaultCollapsed) &&
          onAddTab && <Menu.Divider />}
        {onToggleCollapsible && (
          <Menu.Item
            onClick={onToggleCollapsible}
            data-testid={`group-toggle-collapsible-${container.id}`}
          >
            {collapsible ? 'Disable Collapse' : 'Enable Collapse'}
          </Menu.Item>
        )}
        {collapsible && onToggleDefaultCollapsed && (
          <Menu.Item
            onClick={onToggleDefaultCollapsed}
            data-testid={`group-toggle-default-${container.id}`}
          >
            {defaultCollapsed ? 'Expand by Default' : 'Collapse by Default'}
          </Menu.Item>
        )}
        {onToggleBordered && (
          <Menu.Item
            onClick={onToggleBordered}
            data-testid={`group-toggle-bordered-${container.id}`}
          >
            {bordered ? 'Hide Border' : 'Show Border'}
          </Menu.Item>
        )}
        {onDelete && (
          <>
            {(onAddTab ||
              onToggleCollapsible ||
              onToggleBordered ||
              onToggleDefaultCollapsed) && <Menu.Divider />}
            <Menu.Item
              leftSection={<IconTrash size={14} />}
              color="red"
              onClick={() => setDeleteModalOpen(true)}
              data-testid={`group-delete-${container.id}`}
            >
              Delete Group
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );

  const dragHandle = dragHandleProps && (
    <Flex
      {...dragHandleProps}
      align="center"
      p={2}
      style={{
        cursor: 'grab',
        flexShrink: 0,
        opacity: showControls ? 1 : 0,
        transition: 'opacity 150ms',
      }}
      data-testid={`group-drag-handle-${container.id}`}
    >
      <IconGripVertical
        size={14}
        style={{ color: 'var(--color-text-muted)' }}
      />
    </Flex>
  );

  // Collapsed header: pipe-separated tab names (max 4, then "\u2026")
  const MAX_COLLAPSED_TABS = 4;
  const collapsedTabLabel =
    isCollapsed && hasTabs
      ? tabs
          .slice(0, MAX_COLLAPSED_TABS)
          .map(t => t.title)
          .join(' | ') + (tabs.length > MAX_COLLAPSED_TABS ? ' | \u2026' : '')
      : null;

  const hasContainerAlert = alertingTabIds != null && alertingTabIds.size > 0;

  // Fixed header height to prevent jump on collapse/expand
  const headerHeight = 36;

  return (
    <Box
      data-testid={`group-container-${container.id}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      mt={8}
      style={{
        border: bordered ? '1px solid var(--color-border)' : undefined,
        borderRadius: bordered ? 4 : undefined,
      }}
    >
      {hasTabs && !isCollapsed ? (
        /* Tab bar header (2+ tabs, expanded) */
        <Tabs
          value={resolvedActiveTabId}
          onChange={val => val && onTabChange?.(val)}
        >
          <Flex
            align="center"
            px="sm"
            gap={6}
            mih={headerHeight}
            style={{ borderBottom: '1px solid var(--color-border)' }}
          >
            {dragHandle}
            {chevron}
            <GroupTabBar
              tabs={tabs}
              activeTabId={resolvedActiveTabId}
              showControls={showControls}
              onTabChange={onTabChange}
              onRenameTab={onRenameTab}
              onDeleteTab={onDeleteTab}
              containerId={container.id}
              alertingTabIds={alertingTabIds}
              hoverControlStyle={hoverControlStyle}
            />
            {addTileButton}
            {overflowMenu}
          </Flex>
        </Tabs>
      ) : (
        /* Plain header (1 tab or collapsed) — shows title + chevron */
        <Flex
          align="center"
          gap={6}
          px="sm"
          mih={headerHeight}
          style={{
            borderBottom: isCollapsed
              ? undefined
              : '1px solid var(--color-border)',
          }}
        >
          {dragHandle}
          {chevron}
          {isRenamingGroup ? (
            <form
              onSubmit={e => {
                e.preventDefault();
                handleSaveGroupRename();
              }}
              style={{ flex: 1 }}
            >
              <TextInput
                variant="unstyled"
                value={groupRenameValue}
                onChange={e => setGroupRenameValue(e.target.value)}
                onBlur={handleSaveGroupRename}
                onKeyDown={e => {
                  e.stopPropagation();
                  if (e.key === 'Escape') {
                    setGroupRenameValue(headerTitle);
                    setIsRenamingGroup(false);
                  }
                }}
                autoFocus
                size="sm"
                fw={500}
                w="100%"
                styles={{
                  input: {
                    padding: 0,
                    margin: 0,
                    minHeight: 'auto',
                    height: 'auto',
                  },
                }}
                data-testid={`group-rename-input-${container.id}`}
              />
            </form>
          ) : (
            <Flex
              align="center"
              gap="xs"
              flex={1}
              miw={0}
              style={{ cursor: collapsible ? 'pointer' : undefined }}
              onClick={collapsible ? onToggle : undefined}
            >
              <Text
                size="sm"
                fw={500}
                truncate
                style={{
                  cursor:
                    !collapsedTabLabel && (onRenameTab || onRename)
                      ? 'text'
                      : undefined,
                }}
                onClick={
                  !collapsedTabLabel && (onRenameTab || onRename)
                    ? e => {
                        e.stopPropagation();
                        setGroupRenameValue(headerTitle);
                        setIsRenamingGroup(true);
                      }
                    : undefined
                }
              >
                {collapsedTabLabel ?? headerTitle}
              </Text>
              {isCollapsed && hasContainerAlert && <AlertDot />}
            </Flex>
          )}
          {addTileButton}
          {overflowMenu}
        </Flex>
      )}
      {!isCollapsed && (
        <Box>{children(hasTabs ? resolvedActiveTabId : undefined)}</Box>
      )}
      <Modal
        data-testid="group-delete-modal"
        opened={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        centered
        withCloseButton={false}
      >
        <Text size="sm" opacity={0.7}>
          Delete{' '}
          <Text component="span" fw={700}>
            {headerTitle}
          </Text>
          ?
          {tileCount > 0
            ? ` This group contains ${tileCount} tile${tileCount > 1 ? 's' : ''}.`
            : ''}
        </Text>
        <Group justify="flex-end" mt="md" gap="xs">
          <Button
            data-testid="group-delete-cancel"
            size="xs"
            variant="secondary"
            onClick={() => setDeleteModalOpen(false)}
          >
            Cancel
          </Button>
          {tileCount > 0 && (
            <Button
              data-testid="group-delete-ungroup"
              size="xs"
              variant="primary"
              onClick={() => {
                onDelete?.('ungroup');
                setDeleteModalOpen(false);
              }}
            >
              Ungroup Tiles
            </Button>
          )}
          <Button
            data-testid="group-delete-confirm"
            size="xs"
            variant="danger"
            onClick={() => {
              onDelete?.('delete');
              setDeleteModalOpen(false);
            }}
          >
            {tileCount > 0 ? 'Delete Group & Tiles' : 'Delete Group'}
          </Button>
        </Group>
      </Modal>
    </Box>
  );
}
