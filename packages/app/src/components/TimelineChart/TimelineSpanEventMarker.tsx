import { memo } from 'react';
import { Text, Tooltip } from '@mantine/core';

import { useFormatTime } from '@/useFormatTime';

export type TTimelineSpanEventMarker = {
  timestamp: number; // ms offset from minOffset
  name: string;
  attributes: Record<string, any>;
};

export const TimelineSpanEventMarker = memo(function ({
  marker,
  eventStart,
  eventEnd,
  height,
}: {
  marker: TTimelineSpanEventMarker;
  eventStart: number;
  eventEnd: number;
  height: number;
}) {
  const formatTime = useFormatTime();
  // Calculate marker position as percentage within the span bar (0-100%)
  const spanDuration = eventEnd - eventStart;
  const markerOffsetFromStart = marker.timestamp - eventStart;
  const markerPosition =
    spanDuration > 0 ? (markerOffsetFromStart / spanDuration) * 100 : 0;

  // Format attributes for tooltip
  const attributeEntries = Object.entries(marker.attributes);
  const tooltipContent = (
    <div>
      <Text size="xxs" c="dimmed" mb="xxs">
        {formatTime(new Date(marker.timestamp), { format: 'withMs' })}
      </Text>
      <Text size="xs">{marker.name}</Text>
      {attributeEntries.length > 0 && (
        <div style={{ fontSize: 10, marginTop: 4 }}>
          {attributeEntries.slice(0, 5).map(([key, value]) => (
            <div key={key}>
              <span style={{ color: 'var(--color-text-primary)' }}>{key}:</span>{' '}
              {String(value).length > 50
                ? String(value).substring(0, 50) + '...'
                : String(value)}
            </div>
          ))}
          {attributeEntries.length > 5 && (
            <div style={{ fontStyle: 'italic' }}>
              ...and {attributeEntries.length - 5} more
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <Tooltip
      label={tooltipContent}
      color="var(--color-bg-surface)"
      withArrow
      multiline
      transitionProps={{ transition: 'fade' }}
      style={{
        fontSize: 11,
        maxWidth: 350,
        wordBreak: 'break-word',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: `${markerPosition.toFixed(6)}%`,
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 8,
          height: 8,
          cursor: 'pointer',
          zIndex: 10,
          pointerEvents: 'auto',
        }}
        onMouseEnter={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
      >
        {/* Diamond shape marker */}
        <div
          style={{
            width: 8,
            height: 8,
            backgroundColor: 'var(--color-bg-success)',
            transform: 'rotate(45deg)',
            border: '1px solid #333',
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          }}
        />
        {/* Vertical line extending above and below */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: 1,
            height: height,
            backgroundColor: 'var(--color-bg-success)',
            opacity: 0.4,
            zIndex: -1,
          }}
        />
      </div>
    </Tooltip>
  );
});

TimelineSpanEventMarker.displayName = 'TimelineSpanEventMarker';
