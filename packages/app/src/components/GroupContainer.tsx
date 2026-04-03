import { useState } from 'react';
import { DashboardContainer } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Flex,
  Input,
  Menu,
  Tabs,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  IconChevronRight,
  IconDotsVertical,
  IconGripVertical,
  IconPencil,
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
  onToggleCollapsible?: () => void;
  onToggleBordered?: () => void;
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
  confirm?: (
    message: React.ReactNode,
    confirmLabel?: string,
    options?: { variant?: 'primary' | 'danger' },
  ) => Promise<boolean>;
};

export default function GroupContainer({
  container,
  collapsed,
  defaultCollapsed,
  onToggle,
  onToggleDefaultCollapsed,
  onToggleCollapsible,
  onToggleBordered,
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
  confirm,
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
  const collapsible = container.collapsible !== false;
  const bordered = container.bordered !== false;
  const showControls = hovered || menuOpen;
  const resolvedActiveTabId = activeTabId ?? tabs[0]?.id;
  const isCollapsed = collapsible && collapsed;

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

  const handleDeleteTab = async (tabId: string) => {
    if (confirm) {
      const tab = tabs.find(t => t.id === tabId);
      const confirmed = await confirm(
        <>
          Delete tab{' '}
          <Text component="span" fw={700}>
            {tab?.title ?? 'this tab'}
          </Text>
          ? Tiles will be moved to the first remaining tab.
        </>,
        'Delete',
        { variant: 'danger' },
      );
      if (!confirmed) return;
    }
    onDeleteTab?.(tabId);
  };

  const chevron = collapsible ? (
    <IconChevronRight
      size={16}
      style={{
        transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
        transition: 'transform 150ms ease',
        flexShrink: 0,
        color: 'var(--mantine-color-dimmed)',
        cursor: 'pointer',
      }}
      onClick={onToggle}
      data-testid={`group-chevron-${container.id}`}
    />
  ) : null;

  // Single "Add Tile" button (1 click) shown on hover, plus "Add Tab" in overflow
  const addTileButton = !isCollapsed && onAddTile && (
    <Tooltip label="Add Tile" position="top" withArrow>
      <ActionIcon
        variant="subtle"
        size="sm"
        style={{
          opacity: showControls ? 1 : 0,
          pointerEvents: showControls ? 'auto' : 'none',
        }}
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
          style={{
            opacity: showControls ? 1 : 0,
            pointerEvents: showControls ? 'auto' : 'none',
          }}
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
        {onToggleCollapsible && (
          <Menu.Item
            onClick={onToggleCollapsible}
            data-testid={`group-toggle-collapsible-${container.id}`}
          >
            {collapsible ? 'Disable Collapse' : 'Enable Collapse'}
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
        {collapsible && onToggleDefaultCollapsed && (
          <Menu.Item
            onClick={onToggleDefaultCollapsed}
            data-testid={`group-toggle-default-${container.id}`}
          >
            {defaultCollapsed ? 'Expand by Default' : 'Collapse by Default'}
          </Menu.Item>
        )}
        {onDelete && (
          <>
            <Menu.Divider />
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

  // Collapsed summary: show all tab names when there are multiple tabs
  const collapsedTabSummary =
    isCollapsed && hasTabs ? (
      <Text size="xs" c="dimmed" truncate style={{ maxWidth: 300 }}>
        {tabs.map(t => t.title).join(' · ')}
      </Text>
    ) : null;

  // Fixed header height to prevent jump on collapse/expand
  const headerHeight = 36;

  return (
    <div
      data-testid={`group-container-${container.id}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        border: bordered
          ? '1px solid var(--mantine-color-default-border)'
          : undefined,
        borderRadius: bordered ? 4 : undefined,
        marginTop: 8,
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
            style={{
              borderBottom: '1px solid var(--mantine-color-default-border)',
              minHeight: headerHeight,
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
                      <ActionIcon
                        variant="subtle"
                        size={16}
                        style={{
                          opacity: hoveredTabId === tab.id ? 1 : 0,
                          transition: 'opacity 150ms',
                        }}
                        onClick={e => {
                          e.stopPropagation();
                          handleDeleteTab(tab.id);
                        }}
                        title="Delete tab"
                        data-testid={`tab-delete-${tab.id}`}
                      >
                        <IconTrash size={12} />
                      </ActionIcon>
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
            {/* Rename active tab button */}
            {onRenameTab && resolvedActiveTabId && (
              <Tooltip label="Rename Tab" position="top" withArrow>
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  style={{
                    opacity: showControls ? 1 : 0,
                    pointerEvents: showControls ? 'auto' : 'none',
                  }}
                  onClick={() => {
                    const tab = tabs.find(t => t.id === resolvedActiveTabId);
                    if (tab) {
                      setEditingTabId(tab.id);
                      setEditedTabTitle(tab.title);
                    }
                  }}
                  data-testid={`tab-rename-btn-${container.id}`}
                >
                  <IconPencil size={14} />
                </ActionIcon>
              </Tooltip>
            )}
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
          style={{
            borderBottom: isCollapsed
              ? undefined
              : '1px solid var(--mantine-color-default-border)',
            minHeight: headerHeight,
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
              style={{
                flex: 1,
                minWidth: 0,
                cursor: collapsible ? 'pointer' : undefined,
              }}
              onClick={collapsible ? onToggle : undefined}
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
              {collapsedTabSummary}
            </Flex>
          )}
          {addTileButton}
          {overflowMenu}
        </Flex>
      )}
      {!isCollapsed && (
        <div style={{ padding: 0 }}>
          {children(hasTabs ? resolvedActiveTabId : undefined)}
        </div>
      )}
    </div>
  );
}
