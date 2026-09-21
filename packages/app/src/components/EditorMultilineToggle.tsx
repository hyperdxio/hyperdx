import { ActionIcon, Tooltip } from '@mantine/core';
import {
  IconArrowAutofitHeight,
  IconArrowAutofitUp,
} from '@tabler/icons-react';

export default function EditorMultilineToggle({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  const label = expanded ? 'Show first line' : 'Show all lines';

  return (
    <Tooltip label={label} withArrow>
      <ActionIcon
        variant="subtle"
        size="xs"
        aria-label={label}
        aria-expanded={expanded}
        onMouseDown={event => event.preventDefault()}
        onClick={onToggle}
      >
        {expanded ? (
          <IconArrowAutofitUp size={14} />
        ) : (
          <IconArrowAutofitHeight size={14} />
        )}
      </ActionIcon>
    </Tooltip>
  );
}
