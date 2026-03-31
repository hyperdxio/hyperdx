import { useState } from 'react';
import { DashboardContainer } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  CloseButton,
  Flex,
  Input,
  Menu,
  Tabs,
  Text,
} from '@mantine/core';
import {
  IconChevronRight,
  IconDotsVertical,
  IconEye,
  IconEyeOff,
  IconGripVertical,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';

import { type DragHandleProps } from '@/components/DashboardDndContext';

type GroupContainerProps = {
  container: DashboardContainer;
  collapsed: boolean;
  defaultCollapsed: boolean;
  onToggle: () => void;
  onToggleDefaultCollapsed?: () => void;
  onDelete?: () => void;
  onAddTile?: () => void;
  activeTabId?: string;
  onTabChange?: (tabId: string) => void;
  onAddTab?: () => void;
  onRenameTab?: (tabId: string, newTitle: string) => void;
  onDeleteTab?: (tabId: string) => void;
  onRename?: (newTitle: string) => void;
  children: (activeTabId: string | undefined) => React.ReactNode;
  dragHandleProps?: DragHandleProps;
};

export default function GroupContainer({
  container,
  collapsed,
  defaultCollapsed,
  onToggle,
  onToggleDefaultCollapsed,
  onDelete,
  onAddTile,
  activeTabId,
  onTabChange,
  onAddTab,
  onRenameTab,
  onDeleteTab,
  onRename,
  children,
  dragHandleProps,
}: GroupContainerProps) {
  const [editing, setEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(container.title);
  const [hovered, setHovered] = useState(false);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editedTabTitle, setEditedTabTitle] = useState('');
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const tabs = container.tabs ?? [];
  const hasTabs = tabs.length >= 2;
  const showControls = hovered || menuOpen;
  const resolvedActiveTabId = activeTabId ?? tabs[0]?.id;

  const firstTab = tabs[0];
  const headerTitle = firstTab?.title ?? container.title;

  const handleSaveRename = () => {
    const trimmed = editedTitle.trim();
    if (trimmed && trimmed !== headerTitle) {
      if (firstTab) {
        onRenameTab?.(firstTab.id, trimmed);
      } else {
        onRename?.(trimmed);
      }
    } else {
      setEditedTitle(headerTitle);
    }
    setEditing(false);
  };

  const handleSaveTabRename = (tabId: string) => {
    const trimmed = editedTabTitle.trim();
    const tab = tabs.find(t => t.id === tabId);
    if (trimmed && tab && trimmed !== tab.title) {
      onRenameTab?.(tabId, trimmed);
    }
    setEditingTabId(null);
  };

  const chevron = (
    <IconChevronRight
      size={16}
      style={{
        transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
        transition: 'transform 150ms ease',
        flexShrink: 0,
        color: 'var(--mantine-color-dimmed)',
        cursor: 'pointer',
      }}
      onClick={onToggle}
      data-testid={`group-chevron-${container.id}`}
    />
  );

  const addMenu = !collapsed && (
    <Menu width={200} position="bottom-end">
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          size="xs"
          style={{
            opacity: showControls ? 1 : 0,
            pointerEvents: showControls ? 'auto' : 'none',
          }}
          data-testid={`group-add-menu-${container.id}`}
        >
          <IconPlus size={14} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {onAddTile && <Menu.Item onClick={onAddTile}>Add Tile</Menu.Item>}
        {onAddTab && <Menu.Item onClick={onAddTab}>Add Tab</Menu.Item>}
      </Menu.Dropdown>
    </Menu>
  );

  const overflowMenu = (
    <Menu width={200} position="bottom-end" onChange={setMenuOpen}>
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          size="xs"
          style={{
            opacity: showControls ? 1 : 0,
            pointerEvents: showControls ? 'auto' : 'none',
          }}
        >
          <IconDotsVertical size={14} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {onToggleDefaultCollapsed && (
          <Menu.Item
            leftSection={
              defaultCollapsed ? (
                <IconEye size={14} />
              ) : (
                <IconEyeOff size={14} />
              )
            }
            onClick={onToggleDefaultCollapsed}
            data-testid={`group-toggle-default-${container.id}`}
          >
            {defaultCollapsed ? 'Expand by Default' : 'Collapse by Default'}
          </Menu.Item>
        )}
        {onDelete && (
          <>
            {onToggleDefaultCollapsed && <Menu.Divider />}
            <Menu.Item
              leftSection={<IconTrash size={14} />}
              color="red"
              onClick={onDelete}
            >
              Delete Group
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );

  const dragHandle = dragHandleProps && (
    <div
      {...dragHandleProps}
      style={{
        cursor: 'grab',
        display: 'flex',
        alignItems: 'center',
        padding: 2,
        flexShrink: 0,
        opacity: showControls ? 1 : 0,
        transition: 'opacity 150ms',
      }}
      data-testid={`group-drag-handle-${container.id}`}
    >
      <IconGripVertical
        size={14}
        style={{ color: 'var(--mantine-color-dimmed)' }}
      />
    </div>
  );

  return (
    <div
      data-testid={`group-container-${container.id}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        border: '1px solid var(--mantine-color-default-border)',
        borderRadius: 4,
        marginTop: 8,
      }}
    >
      {hasTabs && !collapsed ? (
        /* Tab bar header (2+ tabs, expanded) */
        <Tabs
          value={resolvedActiveTabId}
          onChange={val => val && onTabChange?.(val)}
        >
          <Flex
            align="center"
            px="sm"
            style={{
              borderBottom: '1px solid var(--mantine-color-default-border)',
            }}
          >
            {dragHandle}
            {chevron}
            <Tabs.List style={{ flex: 1, border: 'none' }}>
              {tabs.map(tab => (
                <Tabs.Tab
                  key={tab.id}
                  value={tab.id}
                  size="sm"
                  onMouseEnter={() => setHoveredTabId(tab.id)}
                  onMouseLeave={() => setHoveredTabId(null)}
                  rightSection={
                    onDeleteTab && tabs.length > 1 ? (
                      <CloseButton
                        size="xs"
                        style={{
                          opacity: hoveredTabId === tab.id ? 1 : 0,
                          transition: 'opacity 150ms',
                        }}
                        onClick={e => {
                          e.stopPropagation();
                          onDeleteTab(tab.id);
                        }}
                        title="Remove tab"
                        data-testid={`tab-close-${tab.id}`}
                      />
                    ) : undefined
                  }
                  onDoubleClick={
                    onRenameTab
                      ? () => {
                          setEditingTabId(tab.id);
                          setEditedTabTitle(tab.title);
                        }
                      : undefined
                  }
                >
                  {editingTabId === tab.id ? (
                    <form
                      onSubmit={e => {
                        e.preventDefault();
                        handleSaveTabRename(tab.id);
                      }}
                      onClick={e => e.stopPropagation()}
                    >
                      <Input
                        size="xs"
                        value={editedTabTitle}
                        onChange={e => setEditedTabTitle(e.currentTarget.value)}
                        onBlur={() => handleSaveTabRename(tab.id)}
                        onKeyDown={e => {
                          e.stopPropagation();
                          if (e.key === 'Escape') setEditingTabId(null);
                        }}
                        autoFocus
                        styles={{ input: { minWidth: 60, height: 22 } }}
                        data-testid={`tab-rename-input-${tab.id}`}
                      />
                    </form>
                  ) : (
                    tab.title
                  )}
                </Tabs.Tab>
              ))}
            </Tabs.List>
            {addMenu}
            {overflowMenu}
          </Flex>
        </Tabs>
      ) : (
        /* Plain header (1 tab or collapsed) — shows title + chevron */
        <Flex
          align="center"
          gap="xs"
          px="sm"
          py={4}
          style={{
            borderBottom: collapsed
              ? undefined
              : '1px solid var(--mantine-color-default-border)',
          }}
        >
          {dragHandle}
          {chevron}
          {editing ? (
            <form
              onSubmit={e => {
                e.preventDefault();
                handleSaveRename();
              }}
              style={{ flex: 1 }}
            >
              <Input
                size="xs"
                value={editedTitle}
                onChange={e => setEditedTitle(e.currentTarget.value)}
                onBlur={handleSaveRename}
                onKeyDown={e => {
                  e.stopPropagation();
                  if (e.key === 'Escape') {
                    setEditedTitle(headerTitle);
                    setEditing(false);
                  }
                }}
                autoFocus
                data-testid={`group-rename-input-${container.id}`}
              />
            </form>
          ) : (
            <Flex
              align="center"
              gap="xs"
              style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
              onClick={onToggle}
            >
              <Text
                size="sm"
                fw={500}
                truncate
                style={{
                  cursor: onRenameTab || onRename ? 'text' : undefined,
                }}
                onClick={
                  onRenameTab || onRename
                    ? e => {
                        e.stopPropagation();
                        setEditedTitle(headerTitle);
                        setEditing(true);
                      }
                    : undefined
                }
              >
                {headerTitle}
              </Text>
            </Flex>
          )}
          {addMenu}
          {overflowMenu}
        </Flex>
      )}
      {!collapsed && (
        <div style={{ padding: 0 }}>
          {children(hasTabs ? resolvedActiveTabId : undefined)}
        </div>
      )}
    </div>
  );
}
