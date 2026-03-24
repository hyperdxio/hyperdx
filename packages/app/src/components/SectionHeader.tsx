import { useState } from 'react';
import { DashboardContainer } from '@hyperdx/common-utils/dist/types';
import { ActionIcon, Flex, Input, Menu, Text } from '@mantine/core';
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

export default function SectionHeader({
  section,
  tileCount,
  collapsed,
  defaultCollapsed,
  onToggle,
  onToggleDefaultCollapsed,
  onRename,
  onDelete,
  onAddTile,
  dragHandleProps,
}: {
  section: DashboardContainer;
  tileCount: number;
  /** Effective collapsed state (URL state ?? DB default). */
  collapsed: boolean;
  /** The DB-stored default collapsed state. */
  defaultCollapsed: boolean;
  /** Toggle collapse in URL state (chevron click). */
  onToggle: () => void;
  /** Toggle the DB-stored default collapsed state (menu action). */
  onToggleDefaultCollapsed?: () => void;
  onRename?: (newTitle: string) => void;
  onDelete?: () => void;
  onAddTile?: () => void;
  dragHandleProps?: DragHandleProps;
}) {
  const [editing, setEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(section.title);
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const showControls = hovered || menuOpen;
  const hasMenuControls = onDelete != null || onToggleDefaultCollapsed != null;

  const handleSaveRename = () => {
    const trimmed = editedTitle.trim();
    if (trimmed && trimmed !== section.title) {
      onRename?.(trimmed);
    } else {
      setEditedTitle(section.title);
    }
    setEditing(false);
  };

  const handleTitleClick = (e: React.MouseEvent) => {
    if (!onRename) return;
    e.stopPropagation();
    setEditedTitle(section.title);
    setEditing(true);
  };

  return (
    <Flex
      align="center"
      gap="xs"
      px="sm"
      py={4}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderBottom: '1px solid var(--mantine-color-default-border)',
        userSelect: 'none',
      }}
      data-testid={`section-header-${section.id}`}
    >
      {dragHandleProps && (
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
          title="Drag to reorder sections"
          data-testid={`section-drag-handle-${section.id}`}
        >
          <IconGripVertical
            size={14}
            style={{ color: 'var(--mantine-color-dimmed)' }}
          />
        </div>
      )}
      <Flex
        align="center"
        gap="xs"
        style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
        onClick={editing ? undefined : onToggle}
        onKeyDown={
          editing
            ? undefined
            : e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onToggle();
                }
              }
        }
        role="button"
        tabIndex={editing ? undefined : 0}
        aria-expanded={!collapsed}
        aria-label={`Toggle ${section.title} section`}
      >
        <IconChevronRight
          size={16}
          style={{
            transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
            transition: 'transform 150ms ease',
            flexShrink: 0,
            color: 'var(--mantine-color-dimmed)',
          }}
        />
        {editing ? (
          <form
            onSubmit={e => {
              e.preventDefault();
              handleSaveRename();
            }}
            onClick={e => e.stopPropagation()}
          >
            <Input
              size="xs"
              value={editedTitle}
              onChange={e => setEditedTitle(e.currentTarget.value)}
              onBlur={handleSaveRename}
              onKeyDown={e => {
                e.stopPropagation();
                if (e.key === 'Escape') {
                  setEditedTitle(section.title);
                  setEditing(false);
                }
              }}
              autoFocus
              data-testid={`section-rename-input-${section.id}`}
            />
          </form>
        ) : (
          <>
            <Text
              size="sm"
              fw={500}
              truncate
              onClick={onRename ? handleTitleClick : undefined}
              style={onRename ? { cursor: 'text' } : undefined}
            >
              {section.title}
            </Text>
            {collapsed && tileCount > 0 && (
              <Text size="xs" c="dimmed">
                ({tileCount} {tileCount === 1 ? 'tile' : 'tiles'})
              </Text>
            )}
          </>
        )}
      </Flex>
      {onAddTile && !editing && (
        <ActionIcon
          variant="subtle"
          size="xs"
          onClick={e => {
            e.stopPropagation();
            onAddTile();
          }}
          title="Add tile to section"
          data-testid={`section-add-tile-${section.id}`}
          style={{
            opacity: showControls ? 1 : 0,
            pointerEvents: showControls ? 'auto' : 'none',
          }}
        >
          <IconPlus size={14} />
        </ActionIcon>
      )}
      {hasMenuControls && !editing && (
        <Menu width={200} position="bottom-end" onChange={setMenuOpen}>
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              size="xs"
              onClick={e => e.stopPropagation()}
              data-testid={`section-menu-${section.id}`}
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
                data-testid={`section-toggle-default-${section.id}`}
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
                  data-testid={`section-delete-${section.id}`}
                >
                  Delete Section
                </Menu.Item>
              </>
            )}
          </Menu.Dropdown>
        </Menu>
      )}
    </Flex>
  );
}
