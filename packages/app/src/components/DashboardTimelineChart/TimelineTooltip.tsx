import { Text } from '@mantine/core';

import {
  ChartTooltipContainer,
  ChartTooltipItem,
} from '@/components/charts/ChartTooltip';
import { FormatTime } from '@/useFormatTime';

import { resolveSeverityColor } from './severityColors';
import type { TimelineEvent, TimelineLane } from './types';

const MAX_EVENTS_IN_TOOLTIP = 10;
/**
 * Tooltip activations on time-axis charts can land between two adjacent event
 * timestamps. We collect events whose timestamp is within this window of the
 * activated label so dense regions show context, not just exact-match events.
 */
const TS_PROXIMITY_SECONDS = 2;

type TimelineTooltipProps = {
  /** Recharts injects this when the tooltip is active. */
  active?: boolean;
  /** Recharts injects payloads for each series at the active point. */
  payload?: unknown[];
  /** Active timestamp (in seconds, since we use unix-seconds on the X axis). */
  label?: number;
  /** Lanes for the chart, used to look up which events live near `label`. */
  lanes: TimelineLane[];
};

/**
 * Custom Recharts tooltip that renders timeline events near the cursor. We
 * reuse the standard `ChartTooltipContainer`/`ChartTooltipItem` pair so the
 * styling matches the rest of the dashboard's charts.
 */
export function TimelineTooltip({
  active,
  payload,
  label,
  lanes,
}: TimelineTooltipProps) {
  if (!active || !payload?.length || label == null) return null;

  const nearby: { event: TimelineEvent; lane: TimelineLane }[] = [];
  for (const lane of lanes) {
    for (const event of lane.events) {
      if (Math.abs(event.ts - label) < TS_PROXIMITY_SECONDS) {
        nearby.push({ event, lane });
      }
    }
  }

  if (nearby.length === 0) return null;

  return (
    <ChartTooltipContainer header={<FormatTime value={label * 1000} />}>
      {nearby.slice(0, MAX_EVENTS_IN_TOOLTIP).map(({ event, lane }, i) => (
        <ChartTooltipItem
          key={i}
          color={resolveSeverityColor(event.severity) ?? lane.color}
          name={event.label || lane.displayName}
          value={0}
          indicator="square"
        />
      ))}
      {nearby.length > MAX_EVENTS_IN_TOOLTIP && (
        <Text size="xs" c="dimmed">
          +{nearby.length - MAX_EVENTS_IN_TOOLTIP} more
        </Text>
      )}
    </ChartTooltipContainer>
  );
}
