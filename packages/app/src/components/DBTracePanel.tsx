import { useEffect, useState } from 'react';
import { parseAsJson, parseAsString, useQueryState } from 'nuqs';
import { useForm } from 'react-hook-form';
import {
  ActionIcon,
  Box,
  Button,
  Center,
  Divider,
  Flex,
  Group,
  Modal,
  Paper,
  Stack,
  Text,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

import { DBTraceWaterfallChartContainer } from '@/components/DBTraceWaterfallChart';
import { useSource, useUpdateSource } from '@/source';

import { RowDataPanel } from './DBRowDataPanel';
import { TableSourceForm } from './SourceForm';
import { SourceSelectControlled } from './SourceSelect';
import { SQLInlineEditorControlled } from './SQLInlineEditor';

export default function DBTracePanel({
  sourceId,
  traceId,
  dateRange,
  focusDate,
  parentSourceId,
}: {
  parentSourceId?: string;
  sourceId?: string;
  traceId: string;
  dateRange: [Date, Date];
  focusDate: Date;
}) {
  const { control, watch, setValue } = useForm({
    defaultValues: {
      source: sourceId,
    },
  });

  const { data: traceSourceData, isLoading: isTraceSourceLoading } = useSource({
    id: watch('source'),
  });

  const { data: parentSourceData, isLoading: isParentSourceDataLoading } =
    useSource({
      id: parentSourceId,
    });

  const { mutate: updateTableSource } = useUpdateSource();

  const [traceRowWhere, setTraceRowWhere] = useQueryState(
    'traceRowWhere',
    parseAsString,
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
  const [showSourceForm, setShowSourceForm] = useState(false);
  useEffect(() => {
    if (
      isTraceSourceLoading == false &&
      (traceSourceData == null ||
        traceSourceData?.kind == 'log' ||
        traceSourceData?.durationExpression == null)
    ) {
      setShowSourceForm(true);
    }
  }, [showSourceForm, traceSourceData, isTraceSourceLoading]);

  const [
    sourceFormModalOpened,
    { open: openSourceFormModal, close: closeSourceFormModal },
  ] = useDisclosure(false);

  // Reset highlighted row when trace ID changes
  // otherwise we'll show stale span details
  useEffect(() => {
    return () => {
      setTraceRowWhere(null);
    };
  }, [traceId, setTraceRowWhere]);

  return (
    <>
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
            Trace Source
          </Text>
          <SourceSelectControlled control={control} name="source" size="xs" />
          <ActionIcon
            variant="subtle"
            color="dark.2"
            size="sm"
            onClick={
              sourceFormModalOpened ? closeSourceFormModal : openSourceFormModal
            }
            title="Edit Source"
          >
            <Text size="xs">
              <i className="bi bi-gear" />
            </Text>
          </ActionIcon>
        </Group>
      </Flex>
      {(showTraceIdInput || !traceId) && parentSourceId != null && (
        <Stack gap="xs">
          <Text c="gray.4" size="xs">
            Trace ID Expression
          </Text>
          <Flex>
            <SQLInlineEditorControlled
              connectionId={parentSourceData?.id}
              database={parentSourceData?.from.databaseName}
              table={parentSourceData?.from.tableName}
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
      {sourceFormModalOpened && <TableSourceForm sourceId={watch('source')} />}
      {traceSourceData?.kind === 'trace' && (
        <DBTraceWaterfallChartContainer
          traceTableModel={traceSourceData}
          traceId={traceId}
          dateRange={dateRange}
          focusDate={focusDate}
          highlightedRowWhere={traceRowWhere}
          onClick={setTraceRowWhere}
        />
      )}
      {traceSourceData != null && traceRowWhere != null && (
        <>
          <Divider my="md" />
          <Text size="sm" c="dark.2" my="sm">
            Span Details
          </Text>
          <RowDataPanel source={traceSourceData} rowId={traceRowWhere} />
        </>
      )}
      {traceSourceData != null && !traceRowWhere && (
        <Paper shadow="xs" p="xl" mt="md">
          <Center mih={100}>
            <Text size="sm" c="gray.4">
              Please select a span above to view details.
            </Text>
          </Center>
        </Paper>
      )}
    </>
  );
}
