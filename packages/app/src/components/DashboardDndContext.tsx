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
  type: 'section';
  sectionId: string;
  sectionTitle: string;
};

type Props = {
  children: React.ReactNode;
  containers: DashboardContainer[];
  onReorderSections: (fromIndex: number, toIndex: number) => void;
};

// --- Provider (section reorder only) ---

export function DashboardDndProvider({
  children,
  containers,
  onReorderSections,
}: Props) {
  const [activeDrag, setActiveDrag] = useState<DragData | null>(null);

  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: { distance: 8 },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 200, tolerance: 5 },
  });
  const sensors = useSensors(mouseSensor, touchSensor);

  const sectionSortableIds = useMemo(
    () => containers.map(c => `section-sort-${c.id}`),
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

      // Section reorder via sortable
      const overData = over.data.current as DragData | undefined;
      if (
        overData?.type === 'section' &&
        activeData.sectionId !== overData.sectionId
      ) {
        const from = containers.findIndex(c => c.id === activeData.sectionId);
        const to = containers.findIndex(c => c.id === overData.sectionId);
        if (from !== -1 && to !== -1) onReorderSections(from, to);
      }
    },
    [containers, onReorderSections],
  );

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={sectionSortableIds}
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
              {activeDrag.sectionTitle}
            </Text>
          </Box>
        )}
      </DragOverlay>
    </DndContext>
  );
}
