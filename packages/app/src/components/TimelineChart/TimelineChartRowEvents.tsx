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
};

export const TimelineChartRowEvents = memo(function (
  props: TimelineChartRowProps,
) {
  const { events, height, maxVal } = props;

  return events.map(event => {
    const percentX = (event.start / maxVal) * 100;

    const percentWidth = Math.max(
      ((event.end - event.start) / maxVal) * 100,
      event.minWidthPerc ?? 0,
    );

    const durationMs = event.end - event.start;
    const barCenter = (event.start + event.end) / 2;
    const timelineMidpoint = maxVal / 2;
    // Duration on left when majority of bar is past halfway, otherwise on right
    const durationOnRight = barCenter <= timelineMidpoint;

    return (
      <div
        key={event.id}
        style={{
          position: 'absolute',
          left: `${percentX}%`,
          width: `${percentWidth}%`,
          height: '100%',
          padding: '1px 0',
        }}
      >
        <Tooltip
          label={event.tooltip}
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
            className="d-flex align-items-center h-100 cursor-pointer text-truncate hover-opacity"
            style={{
              userSelect: 'none',
              width: '100%',
              position: 'relative',
              borderRadius: 2,
              fontSize: height * 0.5,
              color: event.color,
              backgroundColor: event.backgroundColor,
            }}
          >
            <div style={{ margin: 'auto' }} className="px-2">
              {event.body}
            </div>
            {event.markers?.map((marker, idx) => (
              <TimelineSpanEventMarker
                key={`${event.id}-marker-${idx}`}
                marker={marker}
                eventStart={event.start}
                eventEnd={event.end}
                height={height}
              />
            ))}
          </div>
        </Tooltip>
        {!!event.showDuration && (
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
    );
  });
});

TimelineChartRowEvents.displayName = 'TimelineChartRowEvents';
