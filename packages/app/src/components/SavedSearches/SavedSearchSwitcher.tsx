import { Badge, Button, Group, Text, Tooltip } from '@mantine/core';
import { IconBookmarks, IconCheck, IconChevronDown } from '@tabler/icons-react';

import type { SavedSearchStatus } from './savedSearchStatus';

const STATUS_BADGE = {
  unsaved: { label: 'Unsaved', color: 'gray', icon: undefined },
  saved: { label: 'Saved', color: 'green', icon: <IconCheck size={12} /> },
  edited: { label: 'Edited', color: 'yellow', icon: undefined },
} satisfies Record<
  SavedSearchStatus,
  { label: string; color: string; icon: React.ReactNode }
>;

/** Names the selected saved search, opens the drawer, and shows whether it has been edited. */
export function SavedSearchSwitcher({
  meta,
  name,
  onOpen,
  status,
}: {
  /** Authorship and edit history, shown on hover. */
  meta?: React.ReactNode;
  /** The selected saved search, absent while the search is unsaved. */
  name?: string;
  onOpen: () => void;
  status: SavedSearchStatus;
}) {
  const badge = STATUS_BADGE[status];

  return (
    <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
      <Tooltip withArrow fz="xs" color="gray" label={meta} disabled={!meta}>
        <Button
          variant="secondary"
          size="xs"
          leftSection={<IconBookmarks size={14} />}
          rightSection={<IconChevronDown size={14} />}
          style={{ maxWidth: 220 }}
          data-testid="saved-search-switcher"
          onClick={onOpen}
        >
          {name ? (
            <Text
              span
              inherit
              data-testid="saved-search-name"
              style={{
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {name}
            </Text>
          ) : (
            'Saved searches'
          )}
        </Button>
      </Tooltip>
      <Badge
        variant="light"
        color={badge.color}
        leftSection={badge.icon}
        data-testid="saved-search-status"
      >
        {badge.label}
      </Badge>
    </Group>
  );
}
