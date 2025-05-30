import * as React from 'react';
import cx from 'classnames';
import { ChartConfigWithOptDateRange } from '@hyperdx/common-utils/dist/types';
import { ScrollArea, Skeleton, Stack } from '@mantine/core';
import { useThrottledCallback, useThrottledValue } from '@mantine/hooks';
import { useVirtualizer } from '@tanstack/react-virtual';

import useRowWhere from '@/hooks/useRowWhere';

import { useQueriedChartConfig } from './hooks/useChartConfig';
import { useFormatTime } from './useFormatTime';
import { formatmmss, getShortUrl } from './utils';

import styles from '../styles/SessionSubpanelV2.module.scss';

type SessionEvent = {
  id: string;
  row: Record<string, string>; // original row object
  sortKey: string;
  isError: boolean;
  isSuccess: boolean;
  eventSource: 'navigation' | 'chat' | 'network' | 'custom';
  title: string;
  description: string;
  timestamp: Date;
  formattedTimestamp: string;
  duration: number;
};

const EVENT_ROW_SOURCE_ICONS = {
  navigation: 'bi bi-geo-alt',
  chat: 'bi bi-chat-dots',
  network: 'bi bi-arrow-left-right',
  custom: 'bi bi-cursor',
};

const EventRow = React.forwardRef(
  (
    {
      dataIndex,
      event,
      isHighlighted,
      onClick,
      onTimeClick,
    }: {
      dataIndex: number;
      event: SessionEvent;
      isHighlighted: boolean;
      onClick: VoidFunction;
      onTimeClick: VoidFunction;
    },
    ref: React.Ref<HTMLDivElement>,
  ) => {
    return (
      <div
        data-index={dataIndex}
        ref={ref}
        className={cx(styles.eventRow, {
          [styles.eventRowError]: event.isError,
          [styles.eventRowSuccess]: event.isSuccess,
          [styles.eventRowHighlighted]: isHighlighted,
        })}
      >
        <div className={styles.eventRowIcon}>
          <i
            className={
              EVENT_ROW_SOURCE_ICONS[event.eventSource] || 'bi bi-terminal'
            }
          />
        </div>
        <div className={styles.eventRowContent} onClick={onClick}>
          <div className={styles.eventRowTitle}>
            {event.title}{' '}
            {event.duration > 0 && <span>{event.duration}ms</span>}
          </div>
          <div className={styles.eventRowDescription} title={event.description}>
            {event.description}
          </div>
        </div>
        <div className={styles.eventRowTimestamp} onClick={onTimeClick}>
          <i className="bi bi-play-fill me-1 fs-8" />
          {event.formattedTimestamp}
        </div>
      </div>
    );
  },
);

export const SessionEventList = ({
  queriedConfig,
  aliasMap,
  onClick,
  onTimeClick,
  focus,
  minTs,
  showRelativeTime,
  eventsFollowPlayerPosition,
}: {
  queriedConfig: ChartConfigWithOptDateRange;
  aliasMap: Record<string, string>;
  // highlightedResultId: string | undefined;
  focus: { ts: number; setBy: string } | undefined;
  minTs: number;
  showRelativeTime: boolean;
  onClick: (rowId: string) => void;
  onTimeClick: (ts: number) => void;
  eventsFollowPlayerPosition: boolean;
}) => {
  const { data, isLoading, isError, error, isPlaceholderData, isSuccess } =
    useQueriedChartConfig(queriedConfig, {
      placeholderData: (prev: any) => prev,
      queryKey: ['SessionEventList', queriedConfig],
    });
  const formatTime = useFormatTime();

  const events = data?.data ?? [];

  const getRowWhere = useRowWhere({ meta: data?.meta, aliasMap });

  const rows = React.useMemo(() => {
    return (
      events.map((event, i) => {
        const { timestamp, durationInMs } = event;

        // TODO: we should just use timestamp and durationInMs instead of startOffset and endOffset
        const startOffset = new Date(timestamp).getTime();
        const endOffset = new Date(startOffset).getTime() + durationInMs;

        const isHighlighted = false;

        const url = event['http.url'];
        const statusCode = event['http.status_code'];
        const method = event['http.method'];
        const shortUrl = getShortUrl(url);

        const isNetworkRequest =
          method != '' && method != null && url != null && url != '';

        const errorMessage = event['error.message'];

        const body = event['body'];
        const component = event['component'];
        const spanName = event['span_name'];
        const locationHref = event['location.href'];
        const otelLibraryName = event['otel.library.name'];
        const shortLocationHref = getShortUrl(locationHref);
        const isException =
          event['exception.group_id'] != '' &&
          event['exception.group_id'] != null;

        const isCustomEvent = otelLibraryName === 'custom-action';
        const isNavigation =
          spanName === 'routeChange' || spanName === 'documentLoad';

        const isError =
          event.severity_text?.toLowerCase() === 'error' ||
          component === 'error' ||
          statusCode > 499;

        const isSuccess = !isError && statusCode < 400 && statusCode > 99;

        return {
          id: event.id,
          sortKey: event.sort_key,
          row: event,
          isError,
          isSuccess,
          eventSource: isNavigation
            ? 'navigation'
            : isNetworkRequest
              ? 'network'
              : isCustomEvent
                ? 'custom'
                : spanName === 'intercom.onShow'
                  ? 'chat'
                  : 'log',
          title: isNavigation
            ? `Navigated`
            : isException
              ? 'Exception'
              : spanName === 'console.error'
                ? 'console.error'
                : spanName === 'console.log'
                  ? 'console.log'
                  : spanName === 'console.warn'
                    ? 'console.warn'
                    : url.length > 0
                      ? `${statusCode} ${method}`
                      : spanName === 'intercom.onShow'
                        ? 'Intercom Chat Opened'
                        : isCustomEvent
                          ? spanName
                          : component === 'console'
                            ? spanName
                            : 'console.error',
          description: isNavigation
            ? shortLocationHref
            : errorMessage != null && errorMessage.length > 0
              ? errorMessage
              : component === 'console'
                ? body
                : url.length > 0
                  ? shortUrl
                  : '',
          timestamp: new Date(startOffset),
          formattedTimestamp: showRelativeTime
            ? formatmmss(startOffset - minTs)
            : formatTime(startOffset, {
                format: 'time',
              }),
          duration: endOffset - startOffset,
        } as SessionEvent;
      }) ?? []
    );
  }, [events, showRelativeTime, minTs, formatTime]);

  const parentRef = React.useRef<HTMLDivElement>(null);

  // The virtualizer
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
  });

  // Sync scroll position to the DOM Player time
  const currentEventIndex = useThrottledValue(
    rows.findIndex(row => row.timestamp.getTime() >= (focus?.ts ?? 0)),
    500,
  );

  React.useEffect(() => {
    if (
      rowVirtualizer &&
      currentEventIndex >= 0 &&
      eventsFollowPlayerPosition
    ) {
      rowVirtualizer.scrollToIndex(currentEventIndex, {
        align: 'center',
      });
    }
  }, [currentEventIndex, eventsFollowPlayerPosition, rowVirtualizer]);

  if (isLoading) {
    return (
      <Stack p="sm" gap="xs">
        <Skeleton height={36} />
        <Skeleton height={36} />
        <Skeleton height={36} />
      </Stack>
    );
  }

  return (
    <ScrollArea h="100%" scrollbarSize={4} viewportRef={parentRef}>
      <div className={styles.eventListContainer}>
        {/* The large inner element to hold all of the items */}
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {/* Only the visible items in the virtualizer, manually positioned to be in view */}
          {rowVirtualizer.getVirtualItems().map(virtualItem => {
            const row = rows[virtualItem.index];

            return (
              <div
                key={virtualItem.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <EventRow
                  event={row}
                  dataIndex={virtualItem.index}
                  isHighlighted={currentEventIndex === virtualItem.index}
                  ref={rowVirtualizer.measureElement}
                  onClick={() => onClick(getRowWhere(row.row))}
                  onTimeClick={() => onTimeClick(row.timestamp.getTime())}
                />
              </div>
            );
          })}
        </div>
      </div>
    </ScrollArea>
  );
};
