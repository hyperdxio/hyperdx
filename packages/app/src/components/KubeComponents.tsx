import * as React from 'react';
import { format, sub } from 'date-fns';
import { Anchor, Badge, Group, Text, Timeline } from '@mantine/core';

import api from '../api';
import Link from 'next/link';

type KubeEvent = {
  id: string;
  timestamp: string;
  severity_text?: string;
  'object.reason'?: string;
  'object.note'?: string;
  'object.type'?: string;
  'k8s.pod.name'?: string;
};

type AnchorEvent = {
  timestamp: string;
  label: React.ReactNode;
};

const FORMAT = 'MMM d hh:mm:ss a';

const renderKubeEvent = (event: KubeEvent) => {
  let href = '#';
  try {
    href = `/search?q=${encodeURIComponent(
      `k8s.pod.name:"${event['k8s.pod.name']}"`,
    )}&from=${new Date(event.timestamp).getTime() - 1000 * 60 * 15}&to=${
      new Date(event.timestamp).getTime() + 1
    }`;
  } catch (_) {
    // ignore
  }

  return (
    <Timeline.Item key={event.id}>
      <Link href={href} passHref>
        <Anchor size={11} c="gray.6" title={event.timestamp}>
          {format(new Date(event.timestamp), FORMAT)}
        </Anchor>
      </Link>
      <Group spacing="xs" my={4}>
        <Text size={12} color="white" fw="bold">
          {event['object.reason']}
        </Text>
        {event['object.type'] && (
          <Badge
            size="xs"
            fw="normal"
            color={event['object.type'] === 'Normal' ? 'green' : 'yellow'}
          >
            {event['object.type']}
          </Badge>
        )}
      </Group>
      <Text size="xs">{event['object.note']}</Text>
    </Timeline.Item>
  );
};

export const KubeTimeline = ({
  q,
  anchorEvent,
  dateRange,
}: {
  q: string;
  dateRange?: [Date, Date];
  anchorEvent?: AnchorEvent;
}) => {
  const startDate = React.useMemo(
    () => dateRange?.[0] ?? sub(new Date(), { days: 7 }),
    [dateRange],
  );
  const endDate = React.useMemo(
    () => dateRange?.[1] ?? new Date(),
    [dateRange],
  );

  const { data, isLoading } = api.useLogBatch({
    q: `k8s.resource.name:"events" ${q}`,
    limit: 50,
    startDate,
    endDate,
    extraFields: [
      'object.metadata.creationTimestamp',
      'object.reason',
      'object.note',
      'object.type',
      'type',
      'k8s.pod.name',
    ],
    order: 'desc',
  });

  const allPodEvents: KubeEvent[] = React.useMemo(
    () =>
      (data?.pages?.[0]?.data || []).sort(
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
  const anchorRef = React.useCallback(node => {
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
        {podEventsBeforeAnchor.map(renderKubeEvent)}
        <Timeline.Item key={anchorEvent.timestamp} ref={anchorRef}>
          <Text size={11} c="gray.6" title={anchorEvent.timestamp}>
            {format(new Date(anchorEvent.timestamp), FORMAT)}
          </Text>
          <Group spacing="xs" my={4}>
            <Text size={12} color="white" fw="bold">
              {anchorEvent.label}
            </Text>
          </Group>
        </Timeline.Item>
        {podEventsAfterAnchor.map(renderKubeEvent)}
      </Timeline>
    );
  } else {
    return (
      <Timeline bulletSize={12} lineWidth={1}>
        {allPodEvents.map(renderKubeEvent)}
      </Timeline>
    );
  }
};
