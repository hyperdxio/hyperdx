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
  // Focus already peeks at the query over the content below; this opens the
  // field for good, reflowing the page so nothing sits underneath it.
  const label = expanded ? 'Collapse after blur' : 'Keep expanded';

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
