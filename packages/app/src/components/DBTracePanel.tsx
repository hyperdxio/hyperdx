import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { useQueryState } from 'nuqs';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import {
  isLogSource,
  isTraceSource,
  SourceKind,
  TSource,
  WithClauseSchema,
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
import {
  IconLayoutBottombar,
  IconLayoutSidebarRight,
  IconX,
} from '@tabler/icons-react';

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
  // The trace this span selection was made in. Used to gate a selection left in
  // the URL from a previous trace so it can't render against a different one.
  traceId?: string;
};

// Validate the persisted span selection so a stale / hand-edited `eventRowWhere`
// (valid JSON but wrong shape) resolves to null instead of feeding a malformed
// row id into the span detail query.
const eventRowWhereSchema = z.object({
  id: z.string(),
  type: z.string(),
  aliasWith: z.array(WithClauseSchema),
  traceId: z.string().optional(),
});
const eventRowWhereParser = parseAsJsonEncoded<EventRowWhere>(
  eventRowWhereSchema.parse,
);

enum SpanDetailTab {
  Overview = 'overview',
  Parsed = 'parsed',
  Infrastructure = 'infrastructure',
}

type TraceDetailLayout = 'side' | 'bottom';

const TRACE_DETAIL_LAYOUT_KEY = 'hdx_trace_detail_layout';

const traceDetailLayoutAtom = atomWithStorage<TraceDetailLayout>(
  TRACE_DETAIL_LAYOUT_KEY,
  'side',
);

// Renders the inline detail for the currently-selected span. Mounted only while
// a span is selected, so it can call useRowData with a real source rather than
// the parent passing a placeholder when nothing is selected. Owns the active
// tab, which resets to Overview when the panel is closed and reopened.
function SpanDetailPanel({
  source,
  rowId,
  aliasWith,
  onClose,
  isSideLayout,
  onToggleLayout,
}: {
  source: TSource;
  rowId: string;
  aliasWith?: WithClause[];
  onClose: () => void;
  isSideLayout: boolean;
  onToggleLayout: () => void;
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
        <Group
          gap={4}
          wrap="nowrap"
          style={{ position: 'absolute', right: 0, top: 0 }}
        >
          <Tooltip
            label={
              isSideLayout
                ? 'Show details at the bottom'
                : 'Show details on the side'
            }
            position="bottom"
          >
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              onClick={onToggleLayout}
              aria-label="Toggle span detail layout"
              data-testid="trace-detail-layout-toggle"
            >
              {isSideLayout ? (
                <IconLayoutBottombar size={16} />
              ) : (
                <IconLayoutSidebarRight size={16} />
              )}
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Close" position="bottom">
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              onClick={onClose}
              aria-label="Close span details"
            >
              <IconX size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </div>
      {/* `flush` drops the panels' inline padding so content aligns with the
          tab bar; the wrapping container already provides the outer inset. */}
      {effectiveTab === SpanDetailTab.Overview && (
        <RowOverviewPanel
          source={source}
          rowId={rowId}
          aliasWith={aliasWith}
          flush
        />
      )}
      {effectiveTab === SpanDetailTab.Parsed && (
        <RowDataPanel
          source={source}
          rowId={rowId}
          aliasWith={aliasWith}
          flush
        />
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

  // A persisted span selection belongs to the trace it was made in. Gate it by
  // the current `traceId` at *read* time so a selection left in the URL from a
  // previous trace (e.g. after "View Trace" opened a different trace, or an old
  // shared link) can never render against this trace's waterfall — no matter how
  // the panel was (re)mounted.
  const selectedSpan =
    eventRowWhere != null && eventRowWhere.traceId === traceId
      ? eventRowWhere
      : null;

  // Stamp the current trace onto every selection so the gate above can tell it
  // apart from a stale one.
  const selectSpan = useCallback(
    (where: { id: string; type: string; aliasWith: WithClause[] }) => {
      setEventRowWhere({ ...where, traceId });
    },
    [setEventRowWhere, traceId],
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
    if (eventRowWhere != null && eventRowWhere.traceId !== traceId) {
      setEventRowWhere(prev =>
        prev != null && prev.traceId !== traceId ? null : prev,
      );
    }
  }, [eventRowWhere, traceId, setEventRowWhere]);

  const [isSourceSchemaPreviewOpen, setIsSourceSchemaPreviewOpen] =
    useState(false);

  const [detailLayout, setDetailLayout] = useAtom(traceDetailLayoutAtom);
  const isSideLayout = detailLayout === 'side';

  const { size: rightPanelSize, startResize: startHorizontalResize } =
    useResizable(35, 'right');

  const { size: bottomPanelSize, startResize: startVerticalResize } =
    useResizable(40, 'top');

  const detailPanelSize = isSideLayout ? rightPanelSize : bottomPanelSize;

  const handleCloseSpanDetails = useCallback(() => {
    setEventRowWhere(null);
  }, [setEventRowWhere]);

  const selectedSpanSource = useMemo(() => {
    if (!selectedSpan) return null;
    if (selectedSpan.type === SourceKind.Log && logSourceData) {
      return logSourceData;
    }
    return traceSourceData;
  }, [selectedSpan, logSourceData, traceSourceData]);

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
      <div
        style={{
          display: 'flex',
          flexDirection: isSideLayout ? 'row' : 'column',
          flex: 1,
          minHeight: 0,
          minWidth: 0,
        }}
      >
        <div
          style={{
            flex: selectedSpan ? `${100 - detailPanelSize} 1 0` : '1 1 100%',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            minWidth: 0,
            minHeight: 0,
          }}
        >
          {traceSourceData?.kind === SourceKind.Trace && traceId && (
            <DBTraceWaterfallChartContainer
              traceTableSource={traceSourceData}
              logTableSource={logSourceData}
              traceId={traceId}
              dateRange={dateRange}
              focusDate={focusDate}
              highlightedRowWhere={selectedSpan?.id}
              onClick={selectSpan}
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

        {selectedSpan != null && (
          <Box
            className={
              isSideLayout
                ? resizeStyles.resizeHandleInline
                : resizeStyles.resizeHandleInlineY
            }
            onMouseDown={
              isSideLayout ? startHorizontalResize : startVerticalResize
            }
          />
        )}

        {traceSourceData != null &&
          selectedSpan != null &&
          selectedSpanSource != null && (
            <div
              style={{
                flex: `${detailPanelSize} 1 0`,
                overflow: 'auto',
                ...(isSideLayout
                  ? {
                      minWidth: 300,
                      borderLeft: '1px solid var(--color-border)',
                      paddingLeft: 'var(--mantine-spacing-sm)',
                    }
                  : {
                      minHeight: 200,
                      borderTop: '1px solid var(--color-border)',
                      paddingTop: 'var(--mantine-spacing-sm)',
                    }),
              }}
            >
              <SpanDetailPanel
                source={selectedSpanSource}
                rowId={selectedSpan.id}
                aliasWith={selectedSpan.aliasWith}
                onClose={handleCloseSpanDetails}
                isSideLayout={isSideLayout}
                onToggleLayout={() =>
                  setDetailLayout(isSideLayout ? 'bottom' : 'side')
                }
              />
            </div>
          )}
      </div>
    </div>
  );
}
