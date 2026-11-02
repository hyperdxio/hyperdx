import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ActionIcon, Box, Group, Text } from '@mantine/core';
import { IconGripVertical, IconX } from '@tabler/icons-react';

export function SortableColumn({
  id,
  label,
  onRemove,
}: {
  id: string;
  label: string;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <Box
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <Group
        gap={4}
        wrap="nowrap"
        align="flex-start"
        w="100%"
        px={4}
        py={2}
        style={{
          borderRadius: 'var(--mantine-radius-sm)',
          background: 'var(--color-bg-muted)',
        }}
      >
        <ActionIcon
          variant="subtle"
          size="xs"
          aria-label={`Reorder ${label}`}
          style={{ cursor: 'grab', touchAction: 'none', flexShrink: 0 }}
          {...attributes}
          {...listeners}
        >
          <IconGripVertical size={14} />
        </ActionIcon>
        <Text
          size="xs"
          ff="monospace"
          lh={1.5}
          style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}
        >
          {label}
        </Text>
        <ActionIcon
          variant="subtle"
          size="xs"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          style={{ flexShrink: 0 }}
        >
          <IconX size={14} />
        </ActionIcon>
      </Group>
    </Box>
  );
}
