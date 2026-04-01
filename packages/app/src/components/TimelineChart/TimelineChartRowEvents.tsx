import { memo } from 'react';
import { Tooltip } from '@mantine/core';

import {
  TimelineSpanEventMarker,
  type TTimelineSpanEventMarker,
} from './TimelineSpanEventMarker';
import { renderMs } from './utils';

import styles from './TimelineChart.module.scss';

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
        const onRight = barCenter <= timelineMidpoint;

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
              }}
            >
              <div
                onMouseEnter={() => onEventHover?.(e.id)}
                className="d-flex align-items-center h-100 cursor-pointer hover-opacity"
                style={{
                  userSelect: 'none',
                  width: '100%',
                  position: 'relative',
                  borderRadius: 2,
                  fontSize: height * 0.5,
                  backgroundColor: e.backgroundColor,
                }}
              >
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
                  className={styles.barDetail}
                  style={{
                    height: '100%',
                    fontSize: height * 0.5,
                    ...(onRight
                      ? { left: '100%', paddingLeft: 4 }
                      : {
                          right: '100%',
                          paddingRight: 4,
                          flexDirection: 'row-reverse',
                        }),
                  }}
                >
                  <span style={{ color: 'var(--color-text-muted)' }}>
                    {renderMs(durationMs)}
                  </span>
                  <span className={styles.barDetailBody}>{e.body}</span>
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
