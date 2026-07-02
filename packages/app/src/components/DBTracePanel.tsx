import {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { add } from 'date-fns';
import { useQueryState } from 'nuqs';
import { useForm, useWatch } from 'react-hook-form';
import SqlString from 'sqlstring';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import {
  isLogSource,
  isTraceSource,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Anchor,
  Box,
  Button,
  Divider,
  Flex,
  Group,
  Loader,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconChevronRight,
  IconPencil,
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
import { SpanLinkData } from './SpanLinksSubpanel';

import resizeStyles from '@/../styles/ResizablePanel.module.scss';

// --- Prototype (HDX-3191 demo): in-place trace navigation -------------------
// A single inline-split flyout navigates between linked traces in place using a
// back stack, instead of stacking a new nested drawer per "Open trace" hop. The
// base entry is the trace the panel opened on; each span-link click pushes a
// hop. This wiring is demo-only (evaluating whether to respec the span-links
// "Open trace" navigation); nothing here ships as-is.
type TraceNavEntry = {
  // Stable React key for the breadcrumb. `base:<traceId>` for the entry the
  // panel opened on; `<traceId>:<spanId>` of the followed link for each hop.
  navKey: string;
  traceId: string;
  dateRange: [Date, Date];
  focusDate: Date;
  // Hint the waterfall uses to auto-select the arrived-at span (see
  // DBTraceWaterfallChart auto-select effect). Shape matches the side panel's
  // initialRowHighlightHint exactly.
  initialRowHighlightHint?: {
    timestamp: string;
    spanId: string;
    body: string;
  };
  // Breadcrumb label: the linked span's name for hops, a short trace id for the
  // base entry.
  label: string;
};

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
  onNavigateToLinkedTrace,
}: {
  source: TSource;
  rowId: string;
  aliasWith?: WithClause[];
  onClose: () => void;
  // Prototype (HDX-3191 demo): forwarded to the Overview panel so a span link's
  // "Open trace" navigates the flyout in place instead of opening a drawer.
  onNavigateToLinkedTrace?: (link: SpanLinkData) => void;
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
        <RowOverviewPanel
          source={source}
          rowId={rowId}
          aliasWith={aliasWith}
          onNavigateToLinkedTrace={onNavigateToLinkedTrace}
        />
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

// Prototype (HDX-3191 demo): resolves a span link (TraceId + SpanId) to the
// linked span's timestamp / body so the trace flyout can navigate to it in
// place. Renders nothing; fires onResolved once the row loads (reusing the same
// SpanId=X AND TraceId=Y resolution the nested-drawer path uses). Mounted only
// while a link is pending, so useRowData always runs with a real where clause.
function LinkedTraceNavResolver({
  source,
  link,
  onResolved,
  onError,
}: {
  source: TSource;
  link: SpanLinkData;
  onResolved: (entry: TraceNavEntry) => void;
  onError: () => void;
}) {
  const where = useMemo(() => {
    if (!isTraceSource(source)) {
      return null;
    }
    return SqlString.format('?=? AND ?=?', [
      SqlString.raw(source.spanIdExpression),
      link.SpanId,
      SqlString.raw(source.traceIdExpression),
      link.TraceId,
    ]);
  }, [source, link]);

  const { data, isError } = useRowData({ source, rowId: where });
  const row = data?.data?.[0];
  const settledRef = useRef(false);

  useEffect(() => {
    if (settledRef.current) {
      return;
    }
    if (isError || where == null) {
      settledRef.current = true;
      onError();
      return;
    }
    if (!row) {
      return;
    }
    settledRef.current = true;

    // Mirror DBRowSidePanel's timestamp parse (epoch seconds vs. ISO string).
    const timestampValue = row['__hdx_timestamp'];
    let focusDate: Date;
    if (typeof timestampValue === 'number') {
      focusDate = new Date(timestampValue * 1000);
    } else {
      focusDate = new Date(timestampValue);
    }
    const bodyValue = row['__hdx_body'];
    const label =
      typeof bodyValue === 'string' && bodyValue.length > 0
        ? bodyValue
        : `Trace ${link.TraceId.slice(0, 8)}`;

    onResolved({
      navKey: `${link.TraceId}:${link.SpanId}`,
      traceId: link.TraceId,
      focusDate,
      dateRange: [
        add(focusDate, { minutes: -60 }),
        add(focusDate, { minutes: 60 }),
      ],
      initialRowHighlightHint: {
        timestamp: row['__hdx_timestamp'],
        spanId: row['__hdx_span_id'],
        body: row['__hdx_body'],
      },
      label,
    });
  }, [row, isError, where, link, onResolved, onError]);

  return null;
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

  const [showTraceIdInput, setShowTraceIdInput] = useState(false);

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

  // --- Prototype (HDX-3191 demo): in-place trace navigation stack ----------
  // Hops pushed above the base trace. Empty => viewing the trace this panel
  // opened on. The base entry is derived fresh from props (never stale); hops
  // are local state. Reset hops whenever the base trace changes.
  const [navHops, setNavHops] = useState<TraceNavEntry[]>([]);
  const [pendingLink, setPendingLink] = useState<SpanLinkData | null>(null);

  // Reset the stack when the base trace changes (new panel / different trace).
  // The "store the previous prop in state and adjust during render" pattern
  // React recommends over an effect for prop-derived state; React discards the
  // in-progress render and immediately re-renders with the reset state.
  const [prevBaseTraceId, setPrevBaseTraceId] = useState(traceId);
  if (prevBaseTraceId !== traceId) {
    setPrevBaseTraceId(traceId);
    setNavHops([]);
    setPendingLink(null);
  }

  const baseEntry = useMemo<TraceNavEntry | null>(() => {
    if (!traceId) return null;
    return {
      navKey: `base:${traceId}`,
      traceId,
      dateRange,
      focusDate,
      initialRowHighlightHint,
      label: `Trace ${traceId.slice(0, 8)}`,
    };
  }, [traceId, dateRange, focusDate, initialRowHighlightHint]);

  const navStack = useMemo<TraceNavEntry[]>(
    () => (baseEntry ? [baseEntry, ...navHops] : []),
    [baseEntry, navHops],
  );
  const activeEntry =
    navStack.length > 0 ? navStack[navStack.length - 1] : null;

  const handleNavigateToLinkedTrace = useCallback((link: SpanLinkData) => {
    setPendingLink(link);
  }, []);

  // Clearing the selected span in the same update as the hop change keeps the
  // right-hand detail pane from showing the previous trace's span for a frame;
  // the destination's initialRowHighlightHint then auto-selects the new span.
  const handlePushResolved = useCallback(
    (entry: TraceNavEntry) => {
      setNavHops(prev => [...prev, entry]);
      setPendingLink(null);
      setEventRowWhere(null);
    },
    [setEventRowWhere],
  );

  // Jump to a breadcrumb level. index is the position in navStack (0 = base);
  // keeping the first `index` hops lands on navStack[index].
  const handleCrumbClick = useCallback(
    (index: number) => {
      setNavHops(prev => prev.slice(0, Math.max(0, index)));
      setPendingLink(null);
      setEventRowWhere(null);
    },
    [setEventRowWhere],
  );

  const handleBack = useCallback(() => {
    setNavHops(prev => prev.slice(0, -1));
    setPendingLink(null);
    setEventRowWhere(null);
  }, [setEventRowWhere]);

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
      <Flex align="center" justify="space-between" mb="sm">
        <Flex align="center">
          <Text size="xs" me="xs">
            {parentSourceData &&
            (isLogSource(parentSourceData) || isTraceSource(parentSourceData))
              ? parentSourceData.traceIdExpression
              : ''}
            : {activeEntry?.traceId || traceId || 'No trace id found for event'}
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
          <SourceSelectControlled
            control={control}
            name="source"
            size="xs"
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
      {/* Prototype (HDX-3191 demo): trace-nav back stack. Shown only once a span
          link has been followed (or one is resolving). Back pops a hop; a crumb
          jumps to that trace. */}
      {(navStack.length > 1 || pendingLink != null) && (
        <Flex
          align="center"
          gap="xs"
          mb="xs"
          wrap="nowrap"
          style={{ minWidth: 0 }}
          data-testid="trace-nav-stack"
        >
          <Tooltip label="Back to previous trace" position="bottom">
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              onClick={handleBack}
              disabled={navStack.length <= 1}
              aria-label="Back to previous trace"
              data-testid="trace-nav-back"
            >
              <IconArrowLeft size={16} />
            </ActionIcon>
          </Tooltip>
          <Flex
            align="center"
            gap={4}
            wrap="nowrap"
            style={{ overflow: 'hidden' }}
          >
            {navStack.map((entry, i) => {
              const isLast = i === navStack.length - 1;
              return (
                <Flex
                  key={entry.navKey}
                  align="center"
                  gap={4}
                  style={{ minWidth: 0 }}
                >
                  {i > 0 && (
                    <IconChevronRight
                      size={12}
                      style={{ flexShrink: 0, opacity: 0.5 }}
                    />
                  )}
                  {isLast ? (
                    <Text
                      size="xs"
                      fw={600}
                      title={entry.label}
                      style={{
                        maxWidth: 220,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {entry.label}
                    </Text>
                  ) : (
                    <Anchor
                      component="button"
                      type="button"
                      size="xs"
                      c="dimmed"
                      onClick={() => handleCrumbClick(i)}
                      title={entry.label}
                      data-testid="trace-nav-crumb"
                      style={{
                        maxWidth: 160,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      {entry.label}
                    </Anchor>
                  )}
                </Flex>
              );
            })}
            {pendingLink != null && (
              <Flex align="center" gap={4} style={{ flexShrink: 0 }}>
                <IconChevronRight size={12} style={{ opacity: 0.5 }} />
                <Loader size="xs" />
                <Text size="xs" c="dimmed">
                  Opening linked trace...
                </Text>
              </Flex>
            )}
          </Flex>
        </Flex>
      )}
      <Divider my="sm" />
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
          {traceSourceData?.kind === SourceKind.Trace && activeEntry && (
            <DBTraceWaterfallChartContainer
              traceTableSource={traceSourceData}
              logTableSource={logSourceData}
              traceId={activeEntry.traceId}
              dateRange={activeEntry.dateRange}
              focusDate={activeEntry.focusDate}
              highlightedRowWhere={eventRowWhere?.id}
              onClick={setEventRowWhere}
              initialRowHighlightHint={activeEntry.initialRowHighlightHint}
              emptyState={emptyState}
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
                onNavigateToLinkedTrace={
                  traceSourceData ? handleNavigateToLinkedTrace : undefined
                }
              />
            </div>
          )}
      </div>

      {/* Prototype (HDX-3191 demo): resolves the pending span link's target span
          (timestamp + body) so the hop carries a real time window and highlight
          hint. Mounted only while a link is pending. */}
      {pendingLink != null && traceSourceData != null && (
        <LinkedTraceNavResolver
          source={traceSourceData}
          link={pendingLink}
          onResolved={handlePushResolved}
          onError={() => setPendingLink(null)}
        />
      )}
    </div>
  );
}
