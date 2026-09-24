import { Button, Text, Tooltip } from '@mantine/core';
import { IconLayoutSidebarRightExpand } from '@tabler/icons-react';

/** Names the current search and opens the saved searches drawer. */
export function SavedSearchSwitcher({
  label,
  meta,
  muted,
  onOpen,
}: {
  label: string;
  /** Authorship and edit history, shown on hover. */
  meta?: React.ReactNode;
  /** Dims the label when it stands in for a name the search does not have yet. */
  muted?: boolean;
  onOpen: () => void;
}) {
  return (
    <Tooltip
      withArrow
      fz="xs"
      color="gray"
      label={meta ?? 'Browse saved searches'}
    >
      <Button
        variant="secondary"
        size="xs"
        rightSection={<IconLayoutSidebarRightExpand size={14} />}
        style={{ flexShrink: 0, maxWidth: 220 }}
        data-testid="saved-search-switcher"
        onClick={onOpen}
      >
        <Text
          span
          inherit
          c={muted ? 'dimmed' : undefined}
          data-testid="saved-search-name"
          style={{
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </Text>
      </Button>
    </Tooltip>
  );
}
