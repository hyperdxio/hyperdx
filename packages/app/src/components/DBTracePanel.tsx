import { useEffect, useState } from 'react';
import { parseAsJson, useQueryState } from 'nuqs';
import { useForm } from 'react-hook-form';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import {
  Badge,
  Button,
  Center,
  Divider,
  Flex,
  Group,
  Paper,
  Stack,
  Text,
} from '@mantine/core';

import { DBTraceWaterfallChartContainer } from '@/components/DBTraceWaterfallChart';
import { useSource, useUpdateSource } from '@/source';
import TabBar from '@/TabBar';

import ServiceMap from './ServiceMap/ServiceMap';
import { RowDataPanel } from './DBRowDataPanel';
import { RowOverviewPanel } from './DBRowOverviewPanel';
import { SourceSelectControlled } from './SourceSelect';
import { SQLInlineEditorControlled } from './SQLInlineEditor';

enum Tab {
  Overview = 'overview',
  Parsed = 'parsed',
}

export default function DBTracePanel({
  childSourceId,
  traceId,
  dateRange,
  focusDate,
  parentSourceId,
  initialRowHighlightHint,
  'data-testid': dataTestId,
}: {
  parentSourceId?: string | null;
  childSourceId?: string | null;
  traceId: string;
  dateRange: [Date, Date];
  focusDate: Date;
  // Passed in from side panel to try to identify which
  // span in the chart to highlight first without constructing
  // a full row where clause
  initialRowHighlightHint?: {
    timestamp: string;
    spanId: string;
    body: string;
  };
  'data-testid'?: string;
}) {
  const { control, watch, setValue } = useForm({
    defaultValues: {
      source: childSourceId,
    },
  });

  const { data: childSourceData, isLoading: isChildSourceDataLoading } =
    useSource({
      id: watch('source'),
    });

  const { data: parentSourceData, isLoading: isParentSourceDataLoading } =
    useSource({
      id: parentSourceId,
    });

  const logSourceData =
    parentSourceData?.kind === SourceKind.Log
      ? parentSourceData
      : childSourceData?.kind === SourceKind.Log
        ? childSourceData
        : null;
  const traceSourceData =
    parentSourceData?.kind === SourceKind.Trace
      ? parentSourceData
      : childSourceData?.kind === SourceKind.Trace
        ? childSourceData
        : null;

  const isTraceSourceLoading =
    childSourceData?.kind === SourceKind.Trace
      ? isChildSourceDataLoading
      : parentSourceData?.kind === SourceKind.Trace
        ? isParentSourceDataLoading
        : false;

  const { mutate: updateTableSource } = useUpdateSource();

  const [eventRowWhere, setEventRowWhere] = useQueryState(
    'eventRowWhere',
    parseAsJson<{ id: string; type: string }>(),
  );

  const {
    control: traceIdControl,
    handleSubmit: traceIdHandleSubmit,
    setValue: traceIdSetValue,
  } = useForm<{ traceIdExpression: string }>({
    defaultValues: {
      traceIdExpression: parentSourceData?.traceIdExpression ?? '',
    },
  });
  useEffect(() => {
    if (parentSourceData?.traceIdExpression) {
      traceIdSetValue('traceIdExpression', parentSourceData.traceIdExpression);
    }
  }, [parentSourceData?.traceIdExpression, traceIdSetValue]);

  const [showTraceIdInput, setShowTraceIdInput] = useState(false);

  // Reset highlighted row when trace ID changes
  // otherwise we'll show stale span details
  useEffect(() => {
    return () => {
      setEventRowWhere(null);
    };
  }, [traceId, setEventRowWhere]);

  const [displayedTab, setDisplayedTab] = useState<Tab>(Tab.Overview);
  return (
    <div data-testid={dataTestId}>
      <Flex align="center" justify="space-between" mb="sm">
        <Flex align="center">
          <Text c="dark.2" size="xs" me="xs">
            {parentSourceData?.traceIdExpression}:{' '}
            {traceId || 'No trace id found for event'}
          </Text>
          {traceId != null && (
            <Button
              variant="subtle"
              color="gray.4"
              size="xs"
              onClick={() => setShowTraceIdInput(v => !v)}
            >
              <i className="bi bi-pencil"></i>
            </Button>
          )}
        </Flex>
        <Group gap="sm">
          <Text size="sm" c="gray.4">
            {parentSourceData?.kind === SourceKind.Log
              ? 'Trace Source'
              : 'Correlated Log Source'}
          </Text>
          <SourceSelectControlled control={control} name="source" size="xs" />
        </Group>
      </Flex>
      {(showTraceIdInput || !traceId) && parentSourceId != null && (
        <Stack gap="xs">
          <Text c="gray.4" size="xs">
            Trace ID Expression
          </Text>
          <Flex>
            <SQLInlineEditorControlled
              tableConnection={tcFromSource(parentSourceData)}
              name="traceIdExpression"
              placeholder="Log Trace ID Column (ex. trace_id)"
              control={traceIdControl}
              size="xs"
            />
            <Button
              ms="sm"
              variant="outline"
              color="green"
              onClick={traceIdHandleSubmit(({ traceIdExpression }) => {
                if (parentSourceData != null) {
                  updateTableSource({
                    source: {
                      ...parentSourceData,
                      traceIdExpression,
                    },
                  });
                }
              })}
              size="xs"
            >
              Save
            </Button>
            <Button
              ms="sm"
              variant="outline"
              color="gray.4"
              onClick={() => setShowTraceIdInput(false)}
              size="xs"
            >
              Cancel
            </Button>
          </Flex>
        </Stack>
      )}
      <Divider my="sm" />
      {traceSourceData?.kind === SourceKind.Trace && (
        <DBTraceWaterfallChartContainer
          traceTableSource={traceSourceData}
          logTableSource={logSourceData}
          traceId={traceId}
          dateRange={dateRange}
          focusDate={focusDate}
          highlightedRowWhere={eventRowWhere?.id}
          onClick={setEventRowWhere}
          initialRowHighlightHint={initialRowHighlightHint}
        />
      )}
      {traceSourceData != null && eventRowWhere != null && (
        <>
          <Divider my="md" />
          <Group>
            <Text size="sm" c="dark.2" my="sm">
              Service Map
            </Text>
            <Badge
              size="xs"
              color="gray.4"
              autoContrast
              radius="sm"
              className="align-text-bottom"
            >
              Beta
            </Badge>
          </Group>
          <div style={{ height: '300px', width: '100%', display: 'flex' }}>
            <ServiceMap
              traceId={traceId}
              traceTableSource={traceSourceData}
              dateRange={dateRange}
            />
          </div>
          <Divider my="md" />
          <Text size="sm" c="dark.2" my="sm">
            Event Details
          </Text>
          <TabBar
            className="fs-8 mt-2"
            items={[
              {
                text: 'Overview',
                value: Tab.Overview,
              },
              {
                text: 'Column Values',
                value: Tab.Parsed,
              },
            ]}
            activeItem={displayedTab}
            onClick={(v: any) => setDisplayedTab(v)}
          />
          {displayedTab === Tab.Overview && (
            <RowOverviewPanel
              source={
                eventRowWhere?.type === SourceKind.Log && logSourceData
                  ? logSourceData
                  : traceSourceData
              }
              rowId={eventRowWhere?.id}
            />
          )}
          {displayedTab === Tab.Parsed && (
            <RowDataPanel
              source={
                eventRowWhere?.type === SourceKind.Log && logSourceData
                  ? logSourceData
                  : traceSourceData
              }
              rowId={eventRowWhere?.id}
            />
          )}
        </>
      )}
      {traceSourceData != null && !eventRowWhere && (
        <Paper shadow="xs" p="xl" mt="md">
          <Center mih={100}>
            <Text size="sm" c="gray.4">
              Please select a span above to view details.
            </Text>
          </Center>
        </Paper>
      )}
    </div>
  );
}
