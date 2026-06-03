import { Button, Tooltip } from '@mantine/core';
import { IconBookmark } from '@tabler/icons-react';

export function SaveAsViewButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  const button = (
    <Button
      variant="subtle"
      size="xs"
      leftSection={<IconBookmark size={14} />}
      disabled={disabled}
      onClick={onClick}
      data-testid="save-as-view-trigger"
    >
      Save as view
    </Button>
  );
  if (disabled) {
    return (
      <Tooltip label="Add a filter, tag, or quick filter first">
        <span>{button}</span>
      </Tooltip>
    );
  }
  return button;
}
