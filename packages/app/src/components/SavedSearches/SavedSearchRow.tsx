import { useRef, useState } from 'react';
import Link from 'next/link';
import type { SavedSearchListApiResponse } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Badge,
  Group,
  Menu,
  Paper,
  Text,
  TextInput,
} from '@mantine/core';
import { useClickOutside } from '@mantine/hooks';
import { IconCopy, IconDots, IconPencil, IconTrash } from '@tabler/icons-react';

import { AlertStatusIcon } from '@/components/AlertStatusIcon';
import { FavoriteButton } from '@/components/FavoriteButton';

export function SavedSearchRow({
  savedSearch,
  onDelete,
  onDuplicate,
  onRename,
}: {
  savedSearch: SavedSearchListApiResponse;
  onDelete: (id: string) => void;
  onDuplicate: (savedSearch: SavedSearchListApiResponse) => void;
  onRename: (id: string, name: string) => void;
}) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(savedSearch.name);
  const isRenamingRef = useRef(false);
  const renameValueRef = useRef(savedSearch.name);
  const visibleTags = savedSearch.tags.slice(0, 2);
  const hiddenTagCount = savedSearch.tags.length - visibleTags.length;

  const startRename = () => {
    setRenameValue(savedSearch.name);
    renameValueRef.current = savedSearch.name;
    isRenamingRef.current = true;
    setIsRenaming(true);
  };

  const commitRename = () => {
    if (!isRenamingRef.current) return;
    isRenamingRef.current = false;
    const trimmed = renameValueRef.current.trim();
    if (trimmed && trimmed !== savedSearch.name) {
      onRename(savedSearch.id, trimmed);
    } else {
      setRenameValue(savedSearch.name);
    }
    setIsRenaming(false);
  };

  const rowRef = useClickOutside(() => {
    if (isRenamingRef.current) commitRename();
  });

  return (
    <Paper
      ref={rowRef}
      withBorder
      p="sm"
      data-testid="saved-search-row"
      style={{ display: 'flex', alignItems: 'center', gap: 8 }}
    >
      {isRenaming ? (
        <form
          onSubmit={event => {
            event.preventDefault();
            commitRename();
          }}
          style={{ flex: 1, minWidth: 0 }}
        >
          <TextInput
            value={renameValue}
            onChange={event => {
              const next = event.currentTarget.value;
              renameValueRef.current = next;
              setRenameValue(next);
            }}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                isRenamingRef.current = false;
                setRenameValue(savedSearch.name);
                setIsRenaming(false);
              }
            }}
            autoFocus
            size="xs"
            aria-label={`Rename ${savedSearch.name}`}
            data-testid="saved-search-rename-input"
          />
        </form>
      ) : (
        <Link
          href={`/search/${savedSearch.id}`}
          style={{
            color: 'inherit',
            flex: 1,
            minWidth: 0,
            textDecoration: 'none',
          }}
        >
          <Group gap={6} wrap="nowrap">
            <Text size="sm" fw={500} truncate="end" style={{ flex: 1 }}>
              {savedSearch.name}
            </Text>
            <AlertStatusIcon alerts={savedSearch.alerts} />
          </Group>
          {savedSearch.tags.length > 0 && (
            <Group gap={4} mt={4} wrap="nowrap">
              {visibleTags.map(tag => (
                <Badge key={tag} variant="light" size="xs">
                  {tag}
                </Badge>
              ))}
              {hiddenTagCount > 0 && (
                <Text size="xs" c="dimmed">
                  +{hiddenTagCount}
                </Text>
              )}
            </Group>
          )}
        </Link>
      )}
      <FavoriteButton
        resourceType="savedSearch"
        resourceId={savedSearch.id}
        size="xs"
      />
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon
            variant="secondary"
            size="sm"
            aria-label={`Actions for ${savedSearch.name}`}
          >
            <IconDots size={14} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            leftSection={<IconPencil size={14} />}
            onClick={startRename}
            data-testid="saved-search-rename"
          >
            Rename
          </Menu.Item>
          <Menu.Item
            leftSection={<IconCopy size={14} />}
            onClick={() => onDuplicate(savedSearch)}
            data-testid="saved-search-duplicate"
          >
            Duplicate
          </Menu.Item>
          <Menu.Item
            color="red"
            leftSection={<IconTrash size={14} />}
            onClick={() => onDelete(savedSearch.id)}
            data-testid="saved-search-delete"
          >
            Delete
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Paper>
  );
}
