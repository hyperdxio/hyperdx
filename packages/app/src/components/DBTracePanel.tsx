import { useEffect, useState } from 'react';
import { parseAsJson, useQueryState } from 'nuqs';
import { useForm, useWatch } from 'react-hook-form';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import {
  Button,
  Center,
  Divider,
  Flex,
  Group,
  Paper,
  Stack,
  Text,
} from '@mantine/core';
import { IconPencil } from '@tabler/icons-react';

import { DBTraceWaterfallChartContainer } from '@/components/DBTraceWaterfallChart';
import { SQLInlineEditorControlled } from '@/components/SearchInput/SQLInlineEditor';
import { WithClause } from '@/hooks/useRowWhere';
import { useSource, useUpdateSource } from '@/source';
import TabBar from '@/TabBar';

import { RowDataPanel } from './DBRowDataPanel';
import { RowOverviewPanel } from './DBRowOverviewPanel';
import { SourceSelectControlled } from './SourceSelect';

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
  traceId?: string;
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
  const { control } = useForm({
    defaultValues: {
      source: childSourceId,
    },
  });

  const sourceId = useWatch({ control, name: 'source' });

  const { data: childSourceData, isLoading: isChildSourceDataLoading } =
    useSource({
      id: sourceId,
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
    parseAsJson<{ id: string; type: string; aliasWith: WithClause[] }>(),
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
          <Text size="xs" me="xs">
            {parentSourceData?.traceIdExpression}:{' '}
            {traceId || 'No trace id found for event'}
          </Text>
          {traceId != null && (
            <Button
              variant="subtle"
              size="xs"
              onClick={() => setShowTraceIdInput(v => !v)}
            >
              <IconPencil size={14} />
            </Button>
          )}
        </Flex>
        <Group gap="sm">
          <Text size="sm">
            {parentSourceData?.kind === SourceKind.Log
              ? 'Trace Source'
              : 'Correlated Log Source'}
          </Text>
          <SourceSelectControlled control={control} name="source" size="xs" />
        </Group>
      </Flex>
      {(showTraceIdInput || !traceId) && parentSourceId != null && (
        <Stack gap="xs">
          <Text size="xs">Trace ID Expression</Text>
          <Flex align="center">
            <SQLInlineEditorControlled
              tableConnection={tcFromSource(parentSourceData)}
              name="traceIdExpression"
              placeholder="Log Trace ID Column (ex. trace_id)"
              control={traceIdControl}
              size="xs"
              parentRef={typeof document !== 'undefined' ? document.body : null}
            />
            <Button
              ms="sm"
              variant="primary"
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
              variant="secondary"
              onClick={() => setShowTraceIdInput(false)}
              size="xs"
            >
              Cancel
            </Button>
          </Flex>
        </Stack>
      )}
      <Divider my="sm" />
      {traceSourceData?.kind === SourceKind.Trace && traceId && (
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
          <Text size="sm" my="sm">
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
              aliasWith={eventRowWhere?.aliasWith}
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
              aliasWith={eventRowWhere?.aliasWith}
            />
          )}
        </>
      )}
      {traceSourceData != null && !eventRowWhere && traceId && (
        <Paper shadow="xs" p="xl" mt="md">
          <Center mih={100}>
            <Text size="sm">Please select a span above to view details.</Text>
          </Center>
        </Paper>
      )}
    </div>
  );
}
