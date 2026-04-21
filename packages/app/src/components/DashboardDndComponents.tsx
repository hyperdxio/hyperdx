import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Box, Button, Center } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';

import { type DragData, type DragHandleProps } from './DashboardDndContext';

export function EmptyContainerPlaceholder({
  containerId,
  children,
  isEmpty,
  onAddTile,
}: {
  containerId: string;
  children?: React.ReactNode;
  isEmpty?: boolean;
  onAddTile?: () => void;
}) {
  return (
    <Box
      data-testid={`container-placeholder-${containerId}`}
      mih={isEmpty ? 80 : undefined}
      pos="relative"
    >
      {isEmpty && (
        <Center pos="absolute" top={0} bottom={0} left={0} right={0} px="md">
          <Button
            variant="secondary"
            fw={400}
            w="100%"
            leftSection={<IconPlus size={16} />}
            onClick={onAddTile}
          >
            Add
          </Button>
        </Center>
      )}
      {children}
    </Box>
  );
}

export function SortableContainerWrapper({
  containerId,
  containerTitle,
  children,
}: {
  containerId: string;
  containerTitle: string;
  children: (dragHandleProps: DragHandleProps) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `container-sort-${containerId}`,
    data: {
      type: 'container',
      containerId,
      containerTitle,
    } satisfies DragData,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <Box ref={setNodeRef} style={style}>
      {children({ ...attributes, ...listeners })}
    </Box>
  );
}
