import * as React from 'react';
import Link from 'next/link';
import { sub } from 'date-fns';
import type { ResponseJSON } from '@clickhouse/client';
import { renderChartConfig } from '@hyperdx/common-utils/dist/renderChartConfig';
import {
  ChartConfigWithDateRange,
  DateRange,
  SearchCondition,
  SearchConditionLanguage,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Anchor, Badge, Group, Text, Timeline } from '@mantine/core';
import { useQuery, UseQueryOptions } from '@tanstack/react-query';

import { useClickhouseClient } from '@/clickhouse';
import { getMetadata } from '@/metadata';
import { getDisplayedTimestampValueExpression, getEventBody } from '@/source';

import { KubePhase } from '../types';
import { FormatTime } from '../useFormatTime';

type KubeEvent = {
  id: string;
  timestamp: string;
  severity_text?: string;
  'k8s.pod.name'?: string;
  'object.message'?: string;
  'object.note'?: string;
  'object.reason'?: string;
  'object.type'?: string;
};

type AnchorEvent = {
  timestamp: string;
  label: React.ReactNode;
};

export const useV2LogBatch = <T = any,>(
  {
    dateRange,
    extraSelects,
    limit,
    logSource,
    order,
    where,
    whereLanguage,
  }: {
    dateRange: DateRange['dateRange'];
    extraSelects?: ChartConfigWithDateRange['select'];
    limit?: number;
    logSource: TSource;
    order: 'asc' | 'desc';
    where: SearchCondition;
    whereLanguage: SearchConditionLanguage;
  },
  options?: Omit<UseQueryOptions<any>, 'queryKey' | 'queryFn'>,
) => {
  const clickhouseClient = useClickhouseClient();
  return useQuery<ResponseJSON<T>, Error>({
    queryKey: [
      'v2LogBatch',
      logSource.id,
      extraSelects,
      dateRange,
      where,
      whereLanguage,
      limit,
      order,
    ],
    queryFn: async () => {
      const query = await renderChartConfig(
        {
          select: [
            {
              valueExpression: getDisplayedTimestampValueExpression(logSource),
              alias: 'timestamp',
            },
            {
              valueExpression: `${logSource.serviceNameExpression}`,
              alias: '_service',
            },
            ...(extraSelects && Array.isArray(extraSelects)
              ? extraSelects
              : []),
          ],
          from: logSource.from,
          dateRange,
          timestampValueExpression: logSource.timestampValueExpression,
          implicitColumnExpression: logSource.implicitColumnExpression,
          where,
          whereLanguage,
          connection: logSource.connection,
          limit: {
            limit: limit ?? 50,
            offset: 0,
          },
          orderBy: `${logSource.timestampValueExpression} ${order}`,
        },
        getMetadata(),
      );

      const json = await clickhouseClient
        .query({
          query: query.sql,
          query_params: query.params,
          connectionId: logSource.connection,
        })
        .then(res => res.json());

      return json as ResponseJSON<T>;
    },
    staleTime: 1000 * 60 * 5, // Cache every 5 min
    ...options,
  });
};

const renderKubeEvent = (source: TSource) => (event: KubeEvent) => {
  let href = '#';
  try {
    // FIXME: should check if it works in v2
    href = `/search?q=${encodeURIComponent(
      `${source.resourceAttributesExpression}.k8s.pod.name:"${event['k8s.pod.name']}"`,
    )}&source=${source.id}&from=${new Date(event.timestamp).getTime() - 1000 * 60 * 15}&to=${
      new Date(event.timestamp).getTime() + 1
    }`;
  } catch (_) {
    // ignore
  }

  return (
    <Timeline.Item key={event.id}>
      <Link href={href} passHref legacyBehavior>
        <Anchor size="xs" fz={11} c="gray.6" title={event.timestamp}>
          <FormatTime value={event.timestamp} />
        </Anchor>
      </Link>
      <Group gap="xs" my={4}>
        <Text size="sm" fz={12} c="white" fw="bold">
          {event['object.reason']}
        </Text>
        {event['object.type'] && (
          <Badge
            variant="light"
            size="xs"
            fw="normal"
            color={event['object.type'] === 'Normal' ? 'green' : 'yellow'}
          >
            {event['object.type']}
          </Badge>
        )}
      </Group>
      <Text size="xs">{event['object.note'] || event['object.message']}</Text>
    </Timeline.Item>
  );
};

export const KubeTimeline = ({
  q,
  logSource,
  anchorEvent,
  dateRange,
}: {
  q: string;
  logSource: TSource;
  dateRange?: [Date, Date];
  anchorEvent?: AnchorEvent;
}) => {
  const startDate = React.useMemo(
    () => dateRange?.[0] ?? sub(new Date(), { days: 1 }),
    [dateRange],
  );
  const endDate = React.useMemo(
    () => dateRange?.[1] ?? new Date(),
    [dateRange],
  );

  const { data, isLoading } = useV2LogBatch<KubeEvent>({
    dateRange: [startDate, endDate],
    limit: 50,
    logSource,
    order: 'desc',
    where: `${logSource.eventAttributesExpression}.k8s.resource.name:"events" ${q}`,
    whereLanguage: 'lucene',
    extraSelects: [
      {
        valueExpression: `generateUUIDv4()`,
        alias: 'id',
      },
      {
        valueExpression: `JSONExtractString(${logSource.eventAttributesExpression}['object'], 'metadata', 'creationTimestamp')`,
        alias: 'object.metadata.creationTimestamp',
      },
      {
        valueExpression: `JSONExtractString(${logSource.eventAttributesExpression}['object'], 'reason')`,
        alias: 'object.reason',
      },
      {
        valueExpression: `JSONExtractString(${logSource.eventAttributesExpression}['object'], 'note')`,
        alias: 'object.note',
      },
      {
        valueExpression: `JSONExtractString(${logSource.eventAttributesExpression}['object'], 'type')`,
        alias: 'object.type',
      },
      {
        valueExpression: `JSONExtractString(${logSource.eventAttributesExpression}['object'], 'message')`,
        alias: 'object.message',
      },
      {
        valueExpression: `JSONExtractString(${logSource.eventAttributesExpression}['object'], 'regarding', 'name')`,
        alias: 'k8s.pod.name',
      },
      {
        valueExpression: `JSONExtractString(${logSource.eventAttributesExpression}['object'], 'regarding', 'uid')`,
        alias: 'k8s.pod.uid',
      },
      {
        valueExpression: `JSONExtractString(${logSource.eventAttributesExpression}['object'], 'type')`,
        alias: 'type',
      },
      {
        valueExpression: `JSONExtractString(${logSource.eventAttributesExpression}['object'], 'type')`,
        alias: 'severity_text',
      },
      {
        valueExpression: `JSONExtractString(${logSource.eventAttributesExpression}['object'], 'note')`,
        alias: 'body',
      },
    ],
  });

  const allPodEvents: KubeEvent[] = React.useMemo(
    () =>
      (data?.data || []).sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      ),
    [data],
  );

  const podEventsBeforeAnchor = React.useMemo(() => {
    return anchorEvent
      ? allPodEvents.filter(event => {
          return new Date(event.timestamp) < new Date(anchorEvent.timestamp);
        })
      : [];
  }, [allPodEvents, anchorEvent]);

  const podEventsAfterAnchor = React.useMemo(() => {
    return anchorEvent
      ? allPodEvents.filter(event => {
          return new Date(event.timestamp) > new Date(anchorEvent.timestamp);
        })
      : [];
  }, [allPodEvents, anchorEvent]);

  // Scroll to anchor event if it exists
  const anchorRef = React.useCallback((node: any) => {
    if (node !== null) {
      // setting block to center causes the entire view to scroll
      // todo - figure out how to scroll just the timeline and center the anchor event
      node.scrollIntoView({ block: 'nearest' });
    }
  }, []);

  if (isLoading) {
    return (
      <Text color="muted" ta="center">
        Loading...
      </Text>
    );
  }

  if (allPodEvents.length === 0) {
    return (
      <Text color="muted" ta="center">
        No events
      </Text>
    );
  }

  if (anchorEvent) {
    return (
      <Timeline bulletSize={12} lineWidth={1}>
        {podEventsAfterAnchor.map(renderKubeEvent(logSource))}
        <Timeline.Item key={anchorEvent.timestamp} ref={anchorRef}>
          <Text size="xs" fz={11} c="gray.6" title={anchorEvent.timestamp}>
            <FormatTime value={anchorEvent.timestamp} />
          </Text>
          <Group gap="xs" my={4}>
            <Text size="sm" fz={12} c="white" fw="bold">
              {anchorEvent.label}
            </Text>
          </Group>
        </Timeline.Item>
        {podEventsBeforeAnchor.map(renderKubeEvent(logSource))}
      </Timeline>
    );
  } else {
    return (
      <Timeline bulletSize={12} lineWidth={1}>
        {allPodEvents.map(renderKubeEvent(logSource))}
      </Timeline>
    );
  }
};

export const FormatPodStatus = ({ status }: { status?: number }) => {
  switch (status) {
    case KubePhase.Pending:
      return (
        <Badge variant="light" color="yellow" fw="normal" tt="none" size="md">
          Pending
        </Badge>
      );
    case KubePhase.Running:
      return (
        <Badge variant="light" color="green" fw="normal" tt="none" size="md">
          Running
        </Badge>
      );
    case KubePhase.Succeeded:
      return (
        <Badge variant="light" color="indigo" fw="normal" tt="none" size="md">
          Succeeded
        </Badge>
      );
    case KubePhase.Failed:
      return (
        <Badge variant="light" color="red" fw="normal" tt="none" size="md">
          Failed
        </Badge>
      );
    case KubePhase.Unknown:
      return (
        <Badge variant="light" color="gray" fw="normal" tt="none" size="md">
          Unknown
        </Badge>
      );
    default:
      return (
        <Badge variant="light" color="gray" fw="normal" tt="none" size="md">
          Unknown
        </Badge>
      );
  }
};
