import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Box, Button } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';

import { type DragData, type DragHandleProps } from './DashboardDndContext';

// --- Empty container placeholder ---
// Visual placeholder for empty groups/tabs with optional add-tile click.

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
    <div
      data-testid={`container-placeholder-${containerId}`}
      style={{
        minHeight: isEmpty ? 80 : undefined,
        borderRadius: 4,
        border: isEmpty
          ? '2px dashed var(--mantine-color-default-border)'
          : undefined,
        position: 'relative',
      }}
    >
      {isEmpty && (
        <Box
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 16px',
          }}
        >
          <Button
            variant="secondary"
            fw={400}
            w="100%"
            leftSection={<IconPlus size={16} />}
            onClick={onAddTile}
          >
            Add
          </Button>
        </Box>
      )}
      {children}
    </div>
  );
}

// --- Sortable container wrapper (for container reordering) ---

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
    <div ref={setNodeRef} style={style}>
      {children({ ...attributes, ...listeners })}
    </div>
  );
}
