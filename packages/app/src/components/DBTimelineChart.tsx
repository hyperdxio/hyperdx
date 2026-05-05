import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Anchor,
  Box,
  Collapse,
  Group,
  ScrollArea,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { keepPreviousData } from '@tanstack/react-query';

import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { FormatTime } from '@/useFormatTime';

import ChartContainer from './charts/ChartContainer';
import ChartErrorState from './charts/ChartErrorState';
import { MemoDashboardTimelineChart } from './DashboardTimelineChart/DashboardTimelineChart';
import { formatTimelineResponse } from './DashboardTimelineChart/formatTimelineResponse';
import type { TimelineEvent } from './DashboardTimelineChart/types';

const EVENTS_TABLE_HEIGHT = 200;
const MAX_EVENTS_RENDERED_IN_TABLE = 100;

type DBTimelineChartProps = {
  config: ChartConfigWithDateRange;
  title?: React.ReactNode;
  /**
   * Items rendered to the right of the title in the chart toolbar, used by
   * dashboard tiles for the menu (edit/delete/fullscreen) buttons.
   */
  toolbarPrefix?: React.ReactNode[];
  /** Called when the user brushes a time range on the chart. */
  onTimeRangeSelect?: (start: Date, end: Date) => void;
  /**
   * Builds a search-page URL for an event marker. When provided, markers
   * become clickable and the events table renders timestamps as links.
   * Receives unix-seconds timestamp + lane key; returns a URL or null.
   */
  buildEventSearchHref?: (eventTs: number, laneKey: string) => string | null;
  queryKeyPrefix?: string;
};

function EventsTable({
  events,
  buildEventSearchHref,
}: {
  events: TimelineEvent[];
  buildEventSearchHref?: DBTimelineChartProps['buildEventSearchHref'];
}) {
  if (events.length === 0) {
    return (
      <Text size="xs" c="dimmed" ta="center" py="xs">
        No events in this time range.
      </Text>
    );
  }

  const hasGroupCol = events.some(e => e.group);
  const hasSeverityCol = events.some(e => e.severity);

  return (
    <ScrollArea h={EVENTS_TABLE_HEIGHT}>
      <Table
        striped
        highlightOnHover
        withTableBorder={false}
        withColumnBorders={false}
        fz="xs"
      >
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={180}>Time</Table.Th>
            <Table.Th>Label</Table.Th>
            {hasGroupCol && <Table.Th w={140}>Group</Table.Th>}
            {hasSeverityCol && <Table.Th w={80}>Severity</Table.Th>}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {events.slice(0, MAX_EVENTS_RENDERED_IN_TABLE).map((event, i) => {
            const href = buildEventSearchHref?.(
              event.ts,
              event.series ?? event.group ?? '_default',
            );
            const timeNode = (
              <FormatTime value={event.ts * 1000} format="withMs" />
            );
            return (
              <Table.Tr key={i}>
                <Table.Td>
                  {href ? (
                    <Anchor component={Link} href={href} size="xs">
                      {timeNode}
                    </Anchor>
                  ) : (
                    timeNode
                  )}
                </Table.Td>
                <Table.Td style={{ wordBreak: 'break-word', maxWidth: 400 }}>
                  {event.label}
                </Table.Td>
                {hasGroupCol && <Table.Td>{event.group}</Table.Td>}
                {hasSeverityCol && <Table.Td>{event.severity}</Table.Td>}
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
      {events.length > MAX_EVENTS_RENDERED_IN_TABLE && (
        <Text size="xxs" c="dimmed" ta="center" py="xs">
          Showing first {MAX_EVENTS_RENDERED_IN_TABLE} of {events.length} events
        </Text>
      )}
    </ScrollArea>
  );
}

export default function DBTimelineChart({
  config,
  title,
  toolbarPrefix,
  onTimeRangeSelect,
  buildEventSearchHref,
  queryKeyPrefix,
}: DBTimelineChartProps) {
  const [showTable, setShowTable] = useState(false);

  const { data, isLoading, isError, error } = useQueriedChartConfig(config, {
    // Avoid flashing the empty state when the user changes filters or
    // dateRange: keep showing the last successful render until new data
    // arrives, matching the behavior of every other chart tile.
    placeholderData: keepPreviousData,
    queryKey: [queryKeyPrefix, config, 'timeline'],
  });

  const { events, lanes } = useMemo(() => {
    if (!data) return { events: [], lanes: [] };
    return formatTimelineResponse(data);
  }, [data]);

  const handleMarkerClick = useCallback(
    (eventTs: number, laneKey: string) => {
      const href = buildEventSearchHref?.(eventTs, laneKey);
      if (href) {
        window.location.href = href;
      }
    },
    [buildEventSearchHref],
  );

  if (isError) {
    return (
      <ChartContainer title={title} toolbarItems={toolbarPrefix}>
        <ChartErrorState error={error} />
      </ChartContainer>
    );
  }

  return (
    // disableReactiveContainer: we own the inner layout. Without this, the
    // ChartContainer wraps children in a position:absolute box which prevents
    // the chart's ResponsiveContainer from measuring height correctly when
    // siblings (legend, events table) also live inside the container.
    <ChartContainer
      title={title}
      toolbarItems={toolbarPrefix}
      disableReactiveContainer
    >
      <Stack gap="xs" h="100%" w="100%" mih={0} style={{ flexGrow: 1 }}>
        <Group gap="xs" px="xs" pt={4} justify="space-between" wrap="nowrap">
          <Group gap="md" wrap="wrap">
            {lanes.map(lane => (
              <Group key={lane.key} gap={4} wrap="nowrap">
                <Box
                  w={8}
                  h={8}
                  bg={lane.color}
                  style={{ borderRadius: '50%', flexShrink: 0 }}
                />
                <Text size="xs" c="dimmed">
                  {lane.displayName} ({lane.events.length})
                </Text>
              </Group>
            ))}
          </Group>
          {events.length > 0 && (
            <ActionIcon
              variant="subtle"
              size="xs"
              onClick={() => setShowTable(v => !v)}
              title={showTable ? 'Hide events table' : 'Show events table'}
            >
              {showTable ? (
                <IconChevronDown size={14} />
              ) : (
                <IconChevronRight size={14} />
              )}
            </ActionIcon>
          )}
        </Group>
        <Box flex={1} mih={0} pos="relative">
          <MemoDashboardTimelineChart
            lanes={lanes}
            dateRange={config.dateRange}
            isLoading={isLoading}
            onTimeRangeSelect={onTimeRangeSelect}
            onMarkerClick={buildEventSearchHref ? handleMarkerClick : undefined}
          />
        </Box>
        <Collapse expanded={showTable}>
          <EventsTable
            events={events}
            buildEventSearchHref={buildEventSearchHref}
          />
        </Collapse>
      </Stack>
    </ChartContainer>
  );
}
