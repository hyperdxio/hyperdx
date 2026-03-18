import { memo } from 'react';
import { Tooltip } from '@mantine/core';

import {
  TimelineSpanEventMarker,
  type TTimelineSpanEventMarker,
} from './TimelineSpanEventMarker';
import { renderMs } from './utils';

export type TTimelineEvent = {
  id: string;
  start: number;
  end: number;
  tooltip: string;
  color: string;
  backgroundColor: string;
  body: React.ReactNode;
  minWidthPerc?: number;
  isError?: boolean;
  markers?: TTimelineSpanEventMarker[];
  showDuration?: boolean;
};

type TimelineChartRowProps = {
  events: TTimelineEvent[];
  maxVal: number;
  height: number;
  scale: number;
  offset: number;
  onEventHover?: (eventId: string) => void;
  onEventClick?: (event: TTimelineEvent) => void;
};

export const TimelineChartRowEvents = memo(function ({
  events,
  maxVal,
  height,
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
      {events.map((e: TTimelineEvent, i, arr) => {
        const minWidth = (e.minWidthPerc ?? 0) / 100;
        const lastEvent = arr[i - 1];
        const lastEventMinEnd =
          lastEvent?.start != null ? lastEvent?.start + maxVal * minWidth : 0;
        const lastEventEnd = Math.max(lastEvent?.end ?? 0, lastEventMinEnd);

        const percWidth =
          scale * Math.max((e.end - e.start) / maxVal, minWidth) * 100;
        const percMarginLeft =
          scale * (((e.start - lastEventEnd) / maxVal) * 100);

        const durationMs = e.end - e.start;
        const barCenter = (e.start + e.end) / 2;
        const timelineMidpoint = maxVal / 2;
        // Duration on left when majority of bar is past halfway, otherwise on right
        const durationOnRight = barCenter <= timelineMidpoint;

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
              style={{
                position: 'relative',
                minWidth: `${percWidth.toFixed(6)}%`,
                width: `${percWidth.toFixed(6)}%`,
                marginLeft: `${percMarginLeft.toFixed(6)}%`,
                // overflow: 'visible',
              }}
            >
              <div
                onMouseEnter={() => onEventHover?.(e.id)}
                className="d-flex align-items-center h-100 cursor-pointer text-truncate hover-opacity"
                style={{
                  userSelect: 'none',
                  width: '100%',
                  position: 'relative',
                  borderRadius: 2,
                  fontSize: height * 0.5,
                  color: e.color,
                  backgroundColor: e.backgroundColor,
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
              {!!e.showDuration && (
                <span
                  style={{
                    position: 'absolute',
                    top: 0,
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    fontSize: height * 0.5,
                    color: 'var(--color-text)',
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                    ...(durationOnRight
                      ? { left: '100%', marginLeft: 4 }
                      : { right: '100%', marginRight: 4 }),
                  }}
                >
                  {renderMs(durationMs)}
                </span>
              )}
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
});

TimelineChartRowEvents.displayName = 'TimelineChartRowEvents';
