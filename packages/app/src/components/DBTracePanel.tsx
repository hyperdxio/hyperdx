import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryState } from 'nuqs';
import { useForm, useWatch } from 'react-hook-form';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import {
  isLogSource,
  isTraceSource,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Box,
  Button,
  Flex,
  Group,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconX } from '@tabler/icons-react';

import { DBTraceWaterfallChartContainer } from '@/components/DBTraceWaterfallChart';
import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';
import useResizable from '@/hooks/useResizable';
import { WithClause } from '@/hooks/useRowWhere';
import { useSource, useUpdateSource } from '@/source';
import TabBar from '@/TabBar';
import { parseAsJsonEncoded } from '@/utils/queryParsers';

import DBInfraPanel from './DBInfraPanel';
import { RowDataPanel, rowHasK8sContext, useRowData } from './DBRowDataPanel';
import { RowOverviewPanel } from './DBRowOverviewPanel';
import SourceSchemaPreview, {
  isSourceSchemaPreviewEnabled,
} from './SourceSchemaPreview';
import { SourceSelectControlled } from './SourceSelect';

import resizeStyles from '@/../styles/ResizablePanel.module.scss';

type EventRowWhere = {
  id: string;
  type: string;
  aliasWith: WithClause[];
};

const eventRowWhereParser = parseAsJsonEncoded<EventRowWhere>();

enum SpanDetailTab {
  Overview = 'overview',
  Parsed = 'parsed',
  Infrastructure = 'infrastructure',
}

// Renders the inline detail for the currently-selected span. Mounted only while
// a span is selected, so it can call useRowData with a real source rather than
// the parent passing a placeholder when nothing is selected. Owns the active
// tab, which resets to Overview when the panel is closed and reopened.
function SpanDetailPanel({
  source,
  rowId,
  aliasWith,
  onClose,
}: {
  source: TSource;
  rowId: string;
  aliasWith?: WithClause[];
  onClose: () => void;
}) {
  const [displayedTab, setDisplayedTab] = useState<SpanDetailTab>(
    SpanDetailTab.Overview,
  );

  const { data: rowData } = useRowData({ source, rowId, aliasWith });
  const normalizedRow = rowData?.data?.[0];

  const hasK8sContext = useMemo(
    () => rowHasK8sContext(source, normalizedRow),
    [source, normalizedRow],
  );

  // If the selected span loses k8s context (e.g. switching spans) while the
  // Infrastructure tab is active, fall back to Overview so we don't show a
  // blank panel. Derived rather than synced via an effect.
  const effectiveTab =
    displayedTab === SpanDetailTab.Infrastructure && !hasK8sContext
      ? SpanDetailTab.Overview
      : displayedTab;

  return (
    <>
      <div style={{ position: 'relative' }}>
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
            ...(hasK8sContext
              ? [
                  {
                    text: 'Infrastructure',
                    value: SpanDetailTab.Infrastructure,
                  },
                ]
              : []),
          ]}
          activeItem={effectiveTab}
          onClick={(v: any) => setDisplayedTab(v)}
        />
        <Tooltip label="Close" position="bottom">
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            onClick={onClose}
            aria-label="Close span details"
            style={{ position: 'absolute', right: 0, top: 0 }}
          >
            <IconX size={16} />
          </ActionIcon>
        </Tooltip>
      </div>
      {effectiveTab === SpanDetailTab.Overview && (
        <RowOverviewPanel source={source} rowId={rowId} aliasWith={aliasWith} />
      )}
      {effectiveTab === SpanDetailTab.Parsed && (
        <RowDataPanel source={source} rowId={rowId} aliasWith={aliasWith} />
      )}
      {effectiveTab === SpanDetailTab.Infrastructure && hasK8sContext && (
        <Box style={{ overflowY: 'auto' }}>
          <DBInfraPanel source={source} rowData={normalizedRow} />
        </Box>
      )}
    </>
  );
}

export default function DBTracePanel({
  childSourceId,
  traceId,
  dateRange,
  focusDate,
  parentSourceId,
  initialRowHighlightHint,
  emptyState,
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
  emptyState?: ReactNode;
  'data-testid'?: string;
}) {
  const { control, setValue } = useForm({
    defaultValues: {
      source: childSourceId,
    },
  });

  useEffect(() => {
    setValue('source', childSourceId ?? null);
  }, [childSourceId, setValue]);

  const sourceId = useWatch({ control, name: 'source' });

  const { data: childSourceData } = useSource({
    id: sourceId,
  });

  const { data: parentSourceData } = useSource({
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

  const { mutate: updateTableSource } = useUpdateSource();

  const [eventRowWhere, setEventRowWhere] = useQueryState(
    'eventRowWhere',
    eventRowWhereParser,
  );

  const {
    control: traceIdControl,
    handleSubmit: traceIdHandleSubmit,
    setValue: traceIdSetValue,
  } = useForm<{ traceIdExpression: string }>({
    defaultValues: {
      traceIdExpression:
        (parentSourceData &&
          (isLogSource(parentSourceData) || isTraceSource(parentSourceData)) &&
          parentSourceData.traceIdExpression) ||
        '',
    },
  });
  useEffect(() => {
    if (
      parentSourceData &&
      (isLogSource(parentSourceData) || isTraceSource(parentSourceData)) &&
      parentSourceData.traceIdExpression
    ) {
      traceIdSetValue('traceIdExpression', parentSourceData.traceIdExpression);
    }
  }, [parentSourceData, traceIdSetValue]);

  // Reset highlighted row when trace ID changes
  // otherwise we'll show stale span details
  useEffect(() => {
    return () => {
      setEventRowWhere(null);
    };
  }, [traceId, setEventRowWhere]);

  const [isSourceSchemaPreviewOpen, setIsSourceSchemaPreviewOpen] =
    useState(false);

  // Parent owns the horizontal split sizing; the waterfall lives on the left
  // and the selected span's detail renders inline on the right.
  const { size: rightPanelSize, startResize: startHorizontalResize } =
    useResizable(35, 'right');

  const handleCloseSpanDetails = useCallback(() => {
    setEventRowWhere(null);
  }, [setEventRowWhere]);

  const selectedSpanSource = useMemo(() => {
    if (!eventRowWhere) return null;
    if (eventRowWhere.type === SourceKind.Log && logSourceData) {
      return logSourceData;
    }
    return traceSourceData;
  }, [eventRowWhere, logSourceData, traceSourceData]);

  return (
    <div
      data-testid={dataTestId}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
      }}
    >
      {/* Fallback Trace ID Expression editor: only surfaced when no trace id
          resolved for the event. The trace id itself now lives in the side
          panel header (Copy Trace ID), so it's not duplicated here. */}
      {!traceId && parentSourceId != null && (
        <Stack gap="xs" mb="sm">
          <Text size="xs">Trace ID Expression</Text>
          <Flex align="center">
            <SQLInlineEditorControlled
              tableConnection={tcFromSource(parentSourceData)}
              name="traceIdExpression"
              placeholder="Log Trace ID Column (ex. trace_id)"
              control={traceIdControl}
              size="xs"
              parentRef={typeof document !== 'undefined' ? document.body : null}
              dateRange={dateRange}
              sourceId={sourceId ?? undefined}
            />
            <Button
              ms="sm"
              variant="primary"
              onClick={traceIdHandleSubmit(({ traceIdExpression }) => {
                if (
                  parentSourceData &&
                  (isLogSource(parentSourceData) ||
                    isTraceSource(parentSourceData))
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
          </Flex>
        </Stack>
      )}
      {/* Inline resizable split view: waterfall (left) + span detail (right) */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          minWidth: 0,
        }}
      >
        <div
          style={{
            flex: eventRowWhere ? `${100 - rightPanelSize} 1 0` : '1 1 100%',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            minWidth: 0,
          }}
        >
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
              emptyState={emptyState}
              controlsExtra={
                <Group gap={4} align="center" wrap="nowrap">
                  <Text size="xxs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                    Correlated logs
                  </Text>
                  <SourceSelectControlled
                    control={control}
                    name="source"
                    size="xs"
                    w={150}
                    onSchemaPreview={() => setIsSourceSchemaPreviewOpen(true)}
                    isSchemaPreviewEnabled={isSourceSchemaPreviewEnabled(
                      childSourceData,
                    )}
                  />
                  <SourceSchemaPreview
                    source={childSourceData}
                    controlled
                    open={isSourceSchemaPreviewOpen}
                    onClose={() => setIsSourceSchemaPreviewOpen(false)}
                  />
                </Group>
              }
            />
          )}
        </div>

        {eventRowWhere != null && (
          <Box
            className={resizeStyles.resizeHandleInline}
            onMouseDown={startHorizontalResize}
          />
        )}

        {traceSourceData != null &&
          eventRowWhere != null &&
          selectedSpanSource != null && (
            <div
              style={{
                flex: `${rightPanelSize} 1 0`,
                overflow: 'auto',
                minWidth: 300,
                borderLeft: '1px solid var(--color-border)',
                paddingLeft: 'var(--mantine-spacing-sm)',
              }}
            >
              <SpanDetailPanel
                source={selectedSpanSource}
                rowId={eventRowWhere.id}
                aliasWith={eventRowWhere.aliasWith}
                onClose={handleCloseSpanDetails}
              />
            </div>
          )}
      </div>
    </div>
  );
}
