import type { MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { Group, Stack, Text } from '@mantine/core';

import type { HoveredAnnotation } from './AnnotationHitLayer';
import {
  ChartTooltipContainer,
  ChartTooltipHeader,
  toViewportPoint,
  useChartTooltipZIndex,
} from './ChartTooltip';

/** Gap below the marker so the tooltip does not sit on top of its own label. */
const TOOLTIP_OFFSET_PX = 6;

/**
 * Hover tooltip for a release marker: one row per release in the hovered
 * cluster, each naming the service it belongs to.
 *
 * The service name is the whole point. On the chart the only carrier of that is
 * the marker's colour, which stops being resolvable once the legend overflows
 * past `MAX_LEGEND_ITEMS` and the matching entry hides behind "+N more".
 *
 * Portaled to the body and positioned fixed, matching the series tooltip: a
 * dashboard tile clips its overflow, so an absolutely-positioned tooltip gets
 * cut off at the tile edge.
 */
export function AnnotationTooltip({
  hovered,
  containerRef,
}: {
  hovered: HoveredAnnotation;
  containerRef: MutableRefObject<HTMLDivElement | null>;
}) {
  const zIndex = useChartTooltipZIndex();
  const members = hovered.annotation.members ?? [hovered.annotation];

  // eslint-disable-next-line react-hooks/refs
  const containerRect = containerRef.current?.getBoundingClientRect();
  if (containerRect == null || typeof document === 'undefined') {
    return null;
  }
  const anchor = toViewportPoint(containerRect, hovered.point);

  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: anchor.x,
        top: anchor.y + TOOLTIP_OFFSET_PX,
        transform: 'translateX(-50%)',
        pointerEvents: 'none',
        zIndex,
      }}
    >
      <ChartTooltipContainer
        header={<ChartTooltipHeader labelSeconds={hovered.annotation.x} />}
      >
        <Stack gap={4}>
          {members.map((member, i) => (
            <Group
              key={member.key ?? `annotation-row-${member.x}-${i}`}
              gap={8}
              wrap="nowrap"
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  flexShrink: 0,
                  background: member.color ?? 'var(--color-border)',
                }}
              />
              {member.group != null && (
                <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                  {member.group}
                </Text>
              )}
              <Text size="xs" fw={500} style={{ whiteSpace: 'nowrap' }}>
                {member.label}
              </Text>
            </Group>
          ))}
        </Stack>
      </ChartTooltipContainer>
    </div>,
    document.body,
  );
}
