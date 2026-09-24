import { Badge, Button, Group, Tooltip } from '@mantine/core';
import { IconBookmarks, IconChevronDown } from '@tabler/icons-react';

/** Opens the saved searches drawer, and names the search on screen. */
export function SavedSearchSwitcher({
  meta,
  name,
  onOpen,
}: {
  /** Authorship and edit history, shown on hover. */
  meta?: React.ReactNode;
  /** The saved search on screen, absent while the search is unsaved. */
  name?: string;
  onOpen: () => void;
}) {
  return (
    <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
      <Button
        variant="secondary"
        size="xs"
        leftSection={<IconBookmarks size={14} />}
        rightSection={<IconChevronDown size={14} />}
        data-testid="saved-search-switcher"
        onClick={onOpen}
      >
        Saved searches
      </Button>
      <Tooltip withArrow fz="xs" color="gray" label={meta} disabled={!meta}>
        <Badge
          variant="light"
          color="gray"
          radius="sm"
          fw="normal"
          // Sentence case, since the badge carries a search name as often as
          // it carries a status.
          tt="none"
          c={name ? undefined : 'dimmed'}
          data-testid="saved-search-name"
          style={{ maxWidth: 200 }}
        >
          {name ?? 'Unsaved'}
        </Badge>
      </Tooltip>
    </Group>
  );
}
