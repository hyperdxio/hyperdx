import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryState } from 'nuqs';
import { useForm, useWatch } from 'react-hook-form';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Box,
  Button,
  Center,
  Divider,
  Flex,
  Group,
  Paper,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconPencil, IconX } from '@tabler/icons-react';

import useResizable from '@/hooks/useResizable';
import { WithClause } from '@/hooks/useRowWhere';
import { useSource, useUpdateSource } from '@/source';
import TabBar from '@/TabBar';
import { parseAsJsonEncoded } from '@/utils/queryParsers';

import { SQLInlineEditorControlled } from './SQLEditor/SQLInlineEditor';
import DBInfraPanel from './DBInfraPanel';
import { RowDataPanel, useRowData } from './DBRowDataPanel';
import { RowOverviewPanel } from './DBRowOverviewPanel';
import { DBTraceWaterfallChartContainer } from './DBTraceWaterfallChart';
import { SourceSelectControlled } from './SourceSelect';

import resizeStyles from '@/../styles/ResizablePanel.module.scss';

const eventRowWhereParser = parseAsJsonEncoded<{
  id: string;
  type: string;
  aliasWith: WithClause[];
}>();

enum SpanDetailTab {
  Overview = 'overview',
  Parsed = 'parsed',
  Infrastructure = 'infrastructure',
}

export default function DBTracePanel({
  childSourceId,
  traceId,
  dateRange,
  focusDate,
  parentSourceId,
  parentSource,
  initialRowHighlightHint,
  'data-testid': dataTestId,
}: {
  parentSourceId?: string | null;
  childSourceId?: string | null;
  parentSource?: TSource;
  traceId?: string;
  dateRange: [Date, Date];
  focusDate: Date;
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
    eventRowWhereParser,
  );

  const parentTraceIdExpr =
    parentSourceData?.kind === SourceKind.Log ||
    parentSourceData?.kind === SourceKind.Trace
      ? parentSourceData.traceIdExpression
      : undefined;

  const {
    control: traceIdControl,
    handleSubmit: traceIdHandleSubmit,
    setValue: traceIdSetValue,
  } = useForm<{ traceIdExpression: string }>({
    defaultValues: {
      traceIdExpression: parentTraceIdExpr ?? '',
    },
  });
  useEffect(() => {
    if (parentTraceIdExpr) {
      traceIdSetValue('traceIdExpression', parentTraceIdExpr);
    }
  }, [parentTraceIdExpr, traceIdSetValue]);

  const [showTraceIdInput, setShowTraceIdInput] = useState(false);

  useEffect(() => {
    setEventRowWhere(null);
    return () => {
      setEventRowWhere(null);
    };
  }, [traceId, setEventRowWhere]);

  const [displayedTab, setDisplayedTab] = useState<SpanDetailTab>(
    SpanDetailTab.Overview,
  );

  const [highlightedSpanId, setHighlightedSpanId] = useState<string | null>(
    null,
  );

  const handleSpanClick = useCallback(
    (rowWhere: { id: string; type: string; aliasWith: WithClause[] }) => {
      setHighlightedSpanId(rowWhere.id);
      setEventRowWhere(rowWhere);
    },
    [setEventRowWhere],
  );

  const handleCloseSpanDetails = useCallback(() => {
    setEventRowWhere(null);
  }, [setEventRowWhere]);

  const { size: rightPanelSize, startResize: startHorizontalResize } =
    useResizable(40, 'right');

  const selectedSpanSource = useMemo(() => {
    if (!eventRowWhere) return null;
    if (eventRowWhere.type === SourceKind.Log && logSourceData) {
      return logSourceData;
    }
    return traceSourceData;
  }, [eventRowWhere, logSourceData, traceSourceData]);

  const { data: selectedSpanRowData } = useRowData({
    source: selectedSpanSource ?? ({} as TSource),
    rowId: eventRowWhere?.id,
    aliasWith: eventRowWhere?.aliasWith,
  });

  const selectedSpanNormalizedRow = selectedSpanRowData?.data?.[0];

  const hasSelectedSpanK8sContext = useMemo(() => {
    try {
      if (!selectedSpanSource?.resourceAttributesExpression) return false;
      if (!selectedSpanNormalizedRow) return false;
      const resourceAttrs =
        selectedSpanNormalizedRow['__hdx_resource_attributes'];
      return (
        resourceAttrs?.['k8s.pod.uid'] != null ||
        resourceAttrs?.['k8s.node.name'] != null
      );
    } catch {
      return false;
    }
  }, [selectedSpanSource, selectedSpanNormalizedRow]);

  return (
    <div
      data-testid={dataTestId}
      style={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        height: '100%',
      }}
    >
      {/* Left column: Trace ID header + Waterfall chart */}
      <div
        style={{
          flex: eventRowWhere ? `${100 - rightPanelSize} 1 0` : '1 1 100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minWidth: 0,
          padding: 'var(--mantine-spacing-sm)',
        }}
      >
        <Flex align="center" justify="space-between" mb="sm">
          <Flex align="center">
            <Text size="xs" me="xs">
              {parentTraceIdExpr}: {traceId || 'No trace id found for event'}
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
                parentRef={
                  typeof document !== 'undefined' ? document.body : null
                }
              />
              <Button
                ms="sm"
                variant="primary"
                onClick={traceIdHandleSubmit(({ traceIdExpression }) => {
                  if (
                    parentSourceData != null &&
                    (parentSourceData.kind === SourceKind.Log ||
                      parentSourceData.kind === SourceKind.Trace)
                  ) {
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
            highlightedRowWhere={highlightedSpanId ?? eventRowWhere?.id}
            onClick={handleSpanClick}
            initialRowHighlightHint={initialRowHighlightHint}
          />
        )}
      </div>

      {/* Resize handle */}
      {eventRowWhere != null && (
        <Box
          className={resizeStyles.resizeHandleInline}
          onMouseDown={startHorizontalResize}
        />
      )}

      {/* Right column: Span details */}
      {eventRowWhere != null && (
        <div
          style={{
            flex: `${rightPanelSize} 1 0`,
            overflow: 'auto',
            minWidth: 0,
            borderLeft: '1px solid var(--color-border)',
            paddingLeft: 12,
            padding: 'var(--mantine-spacing-sm)',
          }}
        >
          <Flex align="center" justify="space-between">
            <TabBar
              className="fs-8"
              items={[
                {
                  text: 'Overview',
                  value: SpanDetailTab.Overview,
                },
                {
                  text: 'Column Values',
                  value: SpanDetailTab.Parsed,
                },
                ...(hasSelectedSpanK8sContext
                  ? [
                      {
                        text: 'Infrastructure',
                        value: SpanDetailTab.Infrastructure,
                      },
                    ]
                  : []),
              ]}
              activeItem={displayedTab}
              onClick={(v: any) => setDisplayedTab(v)}
            />
            <Tooltip label="Close" position="bottom">
              <ActionIcon
                variant="subtle"
                size="sm"
                onClick={handleCloseSpanDetails}
                aria-label="Close span details"
              >
                <IconX size={16} />
              </ActionIcon>
            </Tooltip>
          </Flex>
          {displayedTab === SpanDetailTab.Overview && selectedSpanSource && (
            <RowOverviewPanel
              source={selectedSpanSource}
              rowId={eventRowWhere.id}
              aliasWith={eventRowWhere.aliasWith}
            />
          )}
          {displayedTab === SpanDetailTab.Parsed && selectedSpanSource && (
            <RowDataPanel
              source={selectedSpanSource}
              rowId={eventRowWhere.id}
              aliasWith={eventRowWhere.aliasWith}
            />
          )}
          {displayedTab === SpanDetailTab.Infrastructure &&
            hasSelectedSpanK8sContext &&
            selectedSpanSource && (
              <Box style={{ overflowY: 'auto' }}>
                <DBInfraPanel
                  source={selectedSpanSource}
                  rowData={selectedSpanNormalizedRow}
                  rowId={eventRowWhere.id}
                />
              </Box>
            )}
        </div>
      )}
    </div>
  );
}
