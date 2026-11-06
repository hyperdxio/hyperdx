import { createPortal } from 'react-dom';
import { Group, Stack, Text } from '@mantine/core';

import type { HoveredAnnotation } from './AnnotationHitLayer';
import {
  ChartTooltipContainer,
  ChartTooltipHeader,
  useChartTooltipZIndex,
} from './ChartTooltip';

import styles from '@styles/HDXLineChart.module.scss';

/** Gap below the marker so the tooltip does not sit on top of its own label. */
const TOOLTIP_OFFSET_PX = 6;

/**
 * Release values are arbitrary attribute values — a version expression that
 * concatenates several attributes easily outruns the tooltip's fixed width.
 * Wrap rather than overflow: the tooltip is `pointer-events: none`, so the
 * scrollbar an overflow produces can never be reached.
 *
 * `anywhere` rather than `break-word` because only `anywhere` shrinks the
 * element's min-content width, which is what the `wrap="nowrap"` row measures.
 */
const wrapLongValue = { overflowWrap: 'anywhere' } as const;

/**
 * Floor for the service name column. Both values share the row's width, so
 * without this a long version wraps the service name down to a couple of
 * characters per line — the one thing the tooltip exists to say.
 */
const SERVICE_MIN_WIDTH_PX = 80;

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
 * cut off at the tile edge. `hovered.point` is already in viewport pixels,
 * measured from the hit band when the pointer entered it.
 */
export function AnnotationTooltip({ hovered }: { hovered: HoveredAnnotation }) {
  const zIndex = useChartTooltipZIndex();
  const members = hovered.annotation.members ?? [hovered.annotation];

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: hovered.point.x,
        top: hovered.point.y + TOOLTIP_OFFSET_PX,
        transform: 'translateX(-50%)',
        pointerEvents: 'none',
        zIndex,
      }}
    >
      <ChartTooltipContainer
        header={<ChartTooltipHeader labelSeconds={hovered.annotation.x} />}
        contentClassName={styles.annotationTooltipContent}
      >
        <Stack gap={4}>
          {members.map((member, i) => (
            <Group
              key={member.key ?? `annotation-row-${member.x}-${i}`}
              gap={8}
              wrap="nowrap"
              align="flex-start"
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  flexShrink: 0,
                  // Centres the dot on the row's first line of text.
                  marginTop: 5,
                  background: member.color ?? 'var(--color-border)',
                }}
              />
              {member.group != null && (
                <Text
                  size="xs"
                  c="dimmed"
                  style={{ ...wrapLongValue, minWidth: SERVICE_MIN_WIDTH_PX }}
                >
                  {member.group}
                </Text>
              )}
              <Text size="xs" fw={500} style={wrapLongValue}>
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
