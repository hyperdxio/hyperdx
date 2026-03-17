import { useRef, useState } from 'react';
import { DashboardSection } from '@hyperdx/common-utils/dist/types';
import { ActionIcon, Flex, Input, Menu, Text } from '@mantine/core';
import {
  IconChevronRight,
  IconDotsVertical,
  IconEye,
  IconEyeOff,
  IconPencil,
  IconTrash,
} from '@tabler/icons-react';

export default function SectionHeader({
  section,
  tileCount,
  onToggle,
  onRename,
  onDelete,
  onToggleDefaultCollapsed,
}: {
  section: DashboardSection;
  tileCount: number;
  onToggle: () => void;
  onRename?: (newTitle: string) => void;
  onDelete?: () => void;
  onToggleDefaultCollapsed?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(section.title);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasEditControls = onRename || onDelete || onToggleDefaultCollapsed;

  const handleSaveRename = () => {
    const trimmed = editedTitle.trim();
    if (trimmed && trimmed !== section.title) {
      onRename?.(trimmed);
    } else {
      setEditedTitle(section.title);
    }
    setEditing(false);
  };

  return (
    <Flex
      align="center"
      gap="xs"
      px="sm"
      py={4}
      style={{
        cursor: 'pointer',
        borderBottom: '1px solid var(--mantine-color-dark-4)',
        userSelect: 'none',
      }}
      data-testid={`section-header-${section.id}`}
    >
      <Flex
        align="center"
        gap="xs"
        style={{ flex: 1, minWidth: 0 }}
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
        aria-expanded={!section.collapsed}
        aria-label={`Toggle ${section.title} section`}
      >
        <IconChevronRight
          size={16}
          style={{
            transform: section.collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
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
              ref={inputRef}
              size="xs"
              value={editedTitle}
              onChange={e => setEditedTitle(e.currentTarget.value)}
              onBlur={handleSaveRename}
              onKeyDown={e => {
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
            <Text size="sm" fw={500} truncate>
              {section.title}
            </Text>
            {section.collapsed && tileCount > 0 && (
              <Text size="xs" c="dimmed">
                ({tileCount} {tileCount === 1 ? 'tile' : 'tiles'})
              </Text>
            )}
          </>
        )}
      </Flex>
      {hasEditControls && !editing && (
        <Menu width={200} position="bottom-end">
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              size="xs"
              onClick={e => e.stopPropagation()}
              data-testid={`section-menu-${section.id}`}
            >
              <IconDotsVertical size={14} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            {onRename && (
              <Menu.Item
                leftSection={<IconPencil size={14} />}
                onClick={() => {
                  setEditedTitle(section.title);
                  setEditing(true);
                }}
              >
                Rename
              </Menu.Item>
            )}
            {onToggleDefaultCollapsed && (
              <Menu.Item
                leftSection={
                  section.collapsed ? (
                    <IconEye size={14} />
                  ) : (
                    <IconEyeOff size={14} />
                  )
                }
                onClick={onToggleDefaultCollapsed}
              >
                {section.collapsed
                  ? 'Expand by Default'
                  : 'Collapse by Default'}
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
