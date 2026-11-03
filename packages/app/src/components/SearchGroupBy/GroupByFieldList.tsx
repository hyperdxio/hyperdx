import { useRef } from 'react';
import { Checkbox, ScrollArea, Text } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';

const ROW_HEIGHT_ESTIMATE = 26;

export function GroupByFieldList({
  fields,
  selected,
  onToggle,
}: {
  fields: string[];
  selected: string[];
  onToggle: (field: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: fields.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 10,
    getItemKey: index => fields[index] ?? index,
  });

  if (fields.length === 0) {
    return (
      <Text size="xs" c="dimmed" py="xs" ta="center">
        No fields found
      </Text>
    );
  }

  return (
    <ScrollArea.Autosize mah={260} type="auto" viewportRef={viewportRef}>
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map(item => {
          const field = fields[item.index];
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${item.start}px)`,
              }}
            >
              <Checkbox
                size="xs"
                py={4}
                label={field}
                checked={selected.includes(field)}
                onChange={() => onToggle(field)}
              />
            </div>
          );
        })}
      </div>
    </ScrollArea.Autosize>
  );
}
