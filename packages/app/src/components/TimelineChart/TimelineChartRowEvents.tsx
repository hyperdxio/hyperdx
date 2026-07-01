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
    // Render the detail on whichever side has more room: to the right when the
    // bar's center sits in the left half of the timeline, otherwise to the left.
    const onRight = barCenter <= timelineMidpoint;

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
            className="d-flex align-items-center h-100 cursor-pointer hover-opacity"
            style={{
              userSelect: 'none',
              width: '100%',
              position: 'relative',
              borderRadius: 2,
              fontSize: height * 0.5,
              backgroundColor: event.backgroundColor,
            }}
          >
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
            <span className={styles.barDetailBody}>{event.body}</span>
          </span>
        )}
      </div>
    );
  });
});

TimelineChartRowEvents.displayName = 'TimelineChartRowEvents';
