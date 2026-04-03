import React, { useCallback, useMemo, useState } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { DashboardContainer } from '@hyperdx/common-utils/dist/types';
import { Box, Text } from '@mantine/core';

// --- Types ---

export type DragHandleProps = React.HTMLAttributes<HTMLElement>;

export type DragData = {
  type: 'container';
  containerId: string;
  containerTitle: string;
};

type Props = {
  children: React.ReactNode;
  containers: DashboardContainer[];
  onReorderContainers: (fromIndex: number, toIndex: number) => void;
};

// --- Provider (container reorder only) ---

export function DashboardDndProvider({
  children,
  containers,
  onReorderContainers,
}: Props) {
  const [activeDrag, setActiveDrag] = useState<DragData | null>(null);

  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: { distance: 8 },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 200, tolerance: 5 },
  });
  const sensors = useSensors(mouseSensor, touchSensor);

  const containerSortableIds = useMemo(
    () => containers.map(c => `container-sort-${c.id}`),
    [containers],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDrag((event.active.data.current as DragData) ?? null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveDrag(null);
      if (!over) return;

      const activeData = active.data.current as DragData | undefined;
      if (!activeData) return;

      // Container reorder via sortable
      const overData = over.data.current as DragData | undefined;
      if (
        overData?.type === 'container' &&
        activeData.containerId !== overData.containerId
      ) {
        const from = containers.findIndex(c => c.id === activeData.containerId);
        const to = containers.findIndex(c => c.id === overData.containerId);
        if (from !== -1 && to !== -1) onReorderContainers(from, to);
      }
    },
    [containers, onReorderContainers],
  );

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={containerSortableIds}
        strategy={verticalListSortingStrategy}
      >
        {children}
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {activeDrag && (
          <Box
            px="sm"
            py={4}
            style={{
              background: 'var(--mantine-color-body)',
              border: '1px solid var(--mantine-color-default-border)',
              borderRadius: 4,
              opacity: 0.85,
            }}
          >
            <Text size="sm" fw={500}>
              {activeDrag.containerTitle}
            </Text>
          </Box>
        )}
      </DragOverlay>
    </DndContext>
  );
}
