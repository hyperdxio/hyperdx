import { memo } from 'react';
import { Tooltip } from '@mantine/core';

import {
  TimelineSpanEventMarker,
  type TTimelineSpanEventMarker,
} from './TimelineSpanEventMarker';

export type TTimelineEvent = {
  id: string;
  start: number;
  end: number;
  tooltip: string;
  color: string;
  body: React.ReactNode;
  minWidthPerc?: number;
  isError?: boolean;
  markers?: TTimelineSpanEventMarker[];
};

type TimelineChartRowProps = {
  events: TTimelineEvent[] | undefined;
  maxVal: number;
  height: number;
  scale: number;
  offset: number;
  eventStyles?:
    | React.CSSProperties
    | ((event: TTimelineEvent) => React.CSSProperties);
  onEventHover?: (eventId: string) => void;
  onEventClick?: (event: TTimelineEvent) => void;
};

export const TimelineChartRowEvents = memo(function ({
  events,
  maxVal,
  height,
  eventStyles,
  onEventHover,
  scale,
  offset,
}: TimelineChartRowProps) {
  return (
    <div
      className="d-flex overflow-hidden"
      style={{ width: 0, flexGrow: 1, height, position: 'relative' }}
    >
      <div
        style={{ marginRight: `${(-1 * offset * scale).toFixed(6)}%` }}
      ></div>
      {(events ?? []).map((e: TTimelineEvent, i, arr) => {
        const minWidth = (e.minWidthPerc ?? 0) / 100;
        const lastEvent = arr[i - 1];
        const lastEventMinEnd =
          lastEvent?.start != null ? lastEvent?.start + maxVal * minWidth : 0;
        const lastEventEnd = Math.max(lastEvent?.end ?? 0, lastEventMinEnd);

        const percWidth =
          scale * Math.max((e.end - e.start) / maxVal, minWidth) * 100;
        const percMarginLeft =
          scale * (((e.start - lastEventEnd) / maxVal) * 100);

        return (
          <Tooltip
            key={e.id}
            label={e.tooltip}
            color="gray"
            withArrow
            multiline
            transitionProps={{ transition: 'fade-right' }}
            style={{
              fontSize: 11,
              maxWidth: 300,
              wordBreak: 'break-word',
            }}
          >
            <div
              onMouseEnter={() => onEventHover?.(e.id)}
              className="d-flex align-items-center h-100 cursor-pointer text-truncate hover-opacity"
              style={{
                userSelect: 'none',
                backgroundColor: e.color,
                minWidth: `${percWidth.toFixed(6)}%`,
                width: `${percWidth.toFixed(6)}%`,
                marginLeft: `${percMarginLeft.toFixed(6)}%`,
                position: 'relative',
                ...(typeof eventStyles === 'function'
                  ? eventStyles(e)
                  : eventStyles),
              }}
            >
              <div style={{ margin: 'auto' }} className="px-2">
                {e.body}
              </div>
              {e.markers?.map((marker, idx) => (
                <TimelineSpanEventMarker
                  key={`${e.id}-marker-${idx}`}
                  marker={marker}
                  eventStart={e.start}
                  eventEnd={e.end}
                  height={height}
                />
              ))}
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
});

TimelineChartRowEvents.displayName = 'TimelineChartRowEvents';
