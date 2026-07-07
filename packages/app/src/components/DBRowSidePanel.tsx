import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { add } from 'date-fns';
import { isString } from 'lodash';
import { ErrorBoundary, FallbackProps } from 'react-error-boundary';
import { useHotkeys } from 'react-hotkeys-hook';
import SqlString from 'sqlstring';
import {
  isLogSource,
  isTraceSource,
  SourceKind,
  TLogSource,
  TSource,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  CopyButton,
  Drawer,
  Flex,
  Group,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconCopy, IconKeyboard, IconShare, IconX } from '@tabler/icons-react';

import useResizable from '@/hooks/useResizable';
import { WithClause } from '@/hooks/useRowWhere';
import useSidePanelStack, {
  reconcileTab,
  SidePanelStack,
} from '@/hooks/useSidePanelStack';
import useWaterfallSearchState from '@/hooks/useWaterfallSearchState';
import { KeyboardShortcutsModal } from '@/LogSidePanelElements';
import { getEventBody, useSource } from '@/source';
import TabBar from '@/TabBar';
import { SearchConfig } from '@/types';
import { FormatTime } from '@/useFormatTime';
import { formatDistanceToNowStrictShort } from '@/utils';
import { getHighlightedAttributesFromData } from '@/utils/highlightedAttributes';
import { useZIndex, ZIndexContext } from '@/zIndex';

import ServiceMapSidePanel from './ServiceMap/ServiceMapSidePanel';
import { renderMs } from './TimelineChart/utils';
import ContextSubpanel from './ContextSidePanel';
import DBInfraPanel from './DBInfraPanel';
import {
  ROW_DATA_ALIASES,
  RowDataPanel,
  rowHasK8sContext,
  useRowData,
} from './DBRowDataPanel';
import { RowOverviewPanel } from './DBRowOverviewPanel';
import { SourceFrame, Tab } from './DBRowSidePanel.types';
import { DBRowSidePanelErrorState } from './DBRowSidePanelErrorState';
import DBRowSidePanelHeader from './DBRowSidePanelHeader';
import { DBSessionPanel, useSessionId } from './DBSessionPanel';
import DBTracePanel from './DBTracePanel';
import {
  DrawerFullWidthToggle,
  INITIAL_DRAWER_WIDTH_PERCENT,
} from './DrawerUtils';
import LogLevel from './LogLevel';
import SidePanelBreadcrumbs, { BreadcrumbItem } from './SidePanelBreadcrumbs';

import styles from '@/../styles/LogSidePanel.module.scss';

export type RowSidePanelContextProps = {
  onPropertyAddClick?: (
    keyPath: string,
    value: string,
    action?: 'only' | 'exclude' | 'include',
  ) => void;
  generateSearchUrl?: ({
    where,
    whereLanguage,
    source,
  }: {
    where: SearchConfig['where'];
    whereLanguage: SearchConfig['whereLanguage'];
    source?: TSource;
  }) => string;
  generateChartUrl?: (config: {
    aggFn: string;
    field: string;
    groupBy: string[];
  }) => string;
  displayedColumns?: string[];
  toggleColumn?: (column: string) => void;
  shareUrl?: string;
  dbSqlRowTableConfig?: BuilderChartConfigWithDateRange;
  isChildModalOpen?: boolean;
  setChildModalOpen?: (open: boolean) => void;
  source?: TLogSource | TTraceSource;
};

export const RowSidePanelContext = createContext<RowSidePanelContextProps>({});

function SidePanelHeaderActions({
  onClose,
  isFullWidth,
  onToggleFullWidth,
}: {
  onClose: () => void;
  isFullWidth?: boolean;
  onToggleFullWidth?: () => void;
}) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  return (
    <>
      <Group gap={4} wrap="nowrap">
        {onToggleFullWidth && (
          <DrawerFullWidthToggle
            isFullWidth={isFullWidth}
            onToggle={onToggleFullWidth}
          />
        )}
        <Tooltip label="Keyboard shortcuts" position="bottom">
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            onClick={() => setShortcutsOpen(true)}
            aria-label="Keyboard shortcuts"
          >
            <IconKeyboard size={16} />
          </ActionIcon>
        </Tooltip>
        <CopyButton
          value={typeof window !== 'undefined' ? window.location.href : ''}
        >
          {({ copied, copy }) => (
            <Tooltip
              label={copied ? 'Copied!' : 'Share link'}
              position="bottom"
            >
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                onClick={copy}
                aria-label="Share"
              >
                <IconShare size={16} />
              </ActionIcon>
            </Tooltip>
          )}
        </CopyButton>
        <Tooltip label="Close" position="bottom">
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            onClick={onClose}
            aria-label="Close"
          >
            <IconX size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
      <KeyboardShortcutsModal
        opened={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </>
  );
}

const SPAN_KIND_LABELS: Record<string, string> = {
  '1': 'Internal',
  '2': 'Server',
  '3': 'Client',
  '4': 'Producer',
  '5': 'Consumer',
  Internal: 'Internal',
  Server: 'Server',
  Client: 'Client',
  Producer: 'Producer',
  Consumer: 'Consumer',
  SPAN_KIND_INTERNAL: 'Internal',
  SPAN_KIND_SERVER: 'Server',
  SPAN_KIND_CLIENT: 'Client',
  SPAN_KIND_PRODUCER: 'Producer',
  SPAN_KIND_CONSUMER: 'Consumer',
};

type DBRowSidePanelProps = {
  source: TSource;
  rowId: string | undefined;
  aliasWith?: WithClause[];
  onClose: () => void;
};

type DBRowSidePanelInnerProps = DBRowSidePanelProps & {
  isFullWidth?: boolean;
  onToggleFullWidth?: () => void;
  persistStacksInUrl?: boolean;
  parentBreadcrumbs?: BreadcrumbItem[];
  onNavigateToParent?: () => void;
  sidePanelStack: SidePanelStack;
};

export const DBRowSidePanelInner = ({
  rowId: initialRowId,
  aliasWith: initialAliasWith,
  source: rootSource,
  onClose,
  isFullWidth,
  onToggleFullWidth,
  parentBreadcrumbs,
  onNavigateToParent,
  sidePanelStack,
}: DBRowSidePanelInnerProps) => {
  const {
    sourceStack,
    navStack,
    tab: persistedTab,
    pushSource,
    pushNav,
    popOne,
    truncateTo,
    setTab,
  } = sidePanelStack;

  const activeSourceFrame =
    sourceStack.length > 0 ? sourceStack[sourceStack.length - 1] : null;

  // Resolve the leaf source (cross-source navigation). Intermediate frames only
  // need their stored label/kind for breadcrumbs.
  const {
    data: activeStackSource,
    isLoading: isStackSourceLoading,
    isSuccess: isStackSourceSettled,
  } = useSource({
    id: activeSourceFrame?.sourceId ?? null,
  });
  const isResolvingSource = activeSourceFrame != null && isStackSourceLoading;

  const isStackSourceMissing =
    activeSourceFrame != null &&
    isStackSourceSettled &&
    activeStackSource == null;
  const source = activeStackSource ?? rootSource;

  const baseRowId = activeSourceFrame?.rowId ?? initialRowId;
  const baseAliasWith = activeSourceFrame?.aliasWith ?? initialAliasWith;

  const leafNav = navStack.length > 0 ? navStack[navStack.length - 1] : null;
  const resolvedRowId = leafNav?.rowId ?? baseRowId;
  const resolvedAliasWith = leafNav?.aliasWith ?? baseAliasWith;

  // Avoid querying the (transiently wrong or unavailable) root source with a
  // leaf row id while the leaf source is still loading or can no longer be
  // resolved.
  const skipRowQuery = isResolvingSource || isStackSourceMissing;
  const activeRowId = skipRowQuery ? undefined : resolvedRowId;
  const activeAliasWith = skipRowQuery ? undefined : resolvedAliasWith;

  const {
    data: rowData,
    isLoading: isRowLoading,
    isSuccess: isRowSuccess,
    isError: isRowError,
    error: rowError,
  } = useRowData({
    source,
    rowId: activeRowId,
    aliasWith: activeAliasWith,
  });

  const hasActiveStacks = activeSourceFrame != null || leafNav != null;

  const parentContext = useContext(RowSidePanelContext);
  // Nested rows shouldn't inherit the parent table's row config.
  const dbSqlRowTableConfig = hasActiveStacks
    ? undefined
    : parentContext.dbSqlRowTableConfig;

  const hasOverviewPanel = useMemo(() => {
    if (isLogSource(source) || isTraceSource(source)) {
      if (
        source.resourceAttributesExpression ||
        source.eventAttributesExpression
      ) {
        return true;
      }
    } else if (
      source.kind === SourceKind.Metric &&
      source.resourceAttributesExpression
    ) {
      return true;
    } else if (source.kind === SourceKind.Promql) {
      return false;
    }
    return false;
  }, [source]);

  const sourceIsTrace = source.kind === SourceKind.Trace;

  const defaultTab = sourceIsTrace
    ? Tab.Trace
    : hasOverviewPanel
      ? Tab.Overview
      : Tab.Parsed;

  const handleNavigateToRow = useCallback(
    (
      rowId: string,
      aliasWith: WithClause[],
      label: string,
      sourceKind?: SourceKind,
    ) => {
      // Same-source drilldown (e.g. surrounding context) → jump to this
      // source's default tab.
      pushNav({ rowId, aliasWith, label, sourceKind }, defaultTab);
    },
    [pushNav, defaultTab],
  );

  const handleSourceStackPush = useCallback(
    (frame: SourceFrame) => {
      // Cross-source push (e.g. "View Trace") → jump to the destination
      // source's default tab.
      const destinationTab =
        frame.sourceKind === SourceKind.Trace ? Tab.Trace : Tab.Overview;
      pushSource(frame, destinationTab);
    },
    [pushSource],
  );

  const handlePanelBack = useCallback(() => {
    // Pop one level (nav → source), restoring the tab active before that level
    // was entered. When the trail is empty, leave the panel: hand off to an
    // embedding parent (session) or close.
    if (popOne() === 'none') {
      if (onNavigateToParent) {
        onNavigateToParent();
      } else {
        onClose();
      }
    }
  }, [popOne, onNavigateToParent, onClose]);

  useHotkeys(['esc'], handlePanelBack);

  const handleBreadcrumbNavigation = useCallback(
    (sourceLevel: number, navLevel: number) =>
      truncateTo(sourceLevel, navLevel),
    [truncateTo],
  );

  const normalizedRow = rowData?.data?.[0];
  const timestampValue = normalizedRow?.['__hdx_timestamp'];

  let timestampDate: Date;
  if (typeof timestampValue === 'number') {
    timestampDate = new Date(timestampValue * 1000);
  } else {
    timestampDate = new Date(timestampValue);
  }

  const mainContentColumn = getEventBody(source);
  const mainContent = isString(normalizedRow?.['__hdx_body'])
    ? normalizedRow['__hdx_body']
    : normalizedRow?.['__hdx_body'] !== undefined
      ? JSON.stringify(normalizedRow['__hdx_body'])
      : undefined;
  const severityText: string | undefined =
    normalizedRow?.['__hdx_severity_text'];

  // Capture the root event body once for the root breadcrumb label.
  const [initialMainContent, setInitialMainContent] = useState<
    string | undefined
  >(undefined);

  useEffect(() => {
    if (mainContent != null && initialMainContent == null && !hasActiveStacks) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInitialMainContent(mainContent);
    }
  }, [mainContent, initialMainContent, hasActiveStacks]);

  const highlightedAttributeValues = useMemo(() => {
    const attributeExpressions: NonNullable<
      (TLogSource | TTraceSource)['highlightedRowAttributeExpressions']
    > = [];
    if (
      (source.kind === SourceKind.Trace || source.kind === SourceKind.Log) &&
      source.highlightedRowAttributeExpressions
    ) {
      attributeExpressions.push(...source.highlightedRowAttributeExpressions);
    }

    // Add service name expression to all sources, to maintain compatibility with
    // the behavior prior to the addition of highlightedRowAttributeExpressions
    if (
      (isLogSource(source) || isTraceSource(source)) &&
      source.serviceNameExpression
    ) {
      attributeExpressions.push({
        sqlExpression: source.serviceNameExpression,
      });
    }

    return rowData
      ? getHighlightedAttributesFromData(
          source,
          attributeExpressions,
          rowData.data || [],
          rowData.meta || [],
        )
      : [];
  }, [source, rowData]);

  const oneHourRange = useMemo(() => {
    return [
      add(timestampDate, { minutes: -60 }),
      add(timestampDate, { minutes: 60 }),
    ] as [Date, Date];
  }, [timestampDate]);

  // For session replay, we need +/-4 hours to get full session
  const fourHourRange = useMemo(() => {
    return [
      add(timestampDate, { hours: -4 }),
      add(timestampDate, { hours: 4 }),
    ] as [Date, Date];
  }, [timestampDate]);

  const focusDate = timestampDate;
  // Coerce empty / falsy trace ids to undefined so "View Trace" / Trace ID
  // is hidden for logs without trace context.
  const traceId: string | undefined =
    normalizedRow?.['__hdx_trace_id'] || undefined;

  const childSourceId = isLogSource(source)
    ? source.traceSourceId
    : isTraceSource(source)
      ? source.logSourceId
      : undefined;

  const traceSourceId = isTraceSource(source)
    ? source.id
    : isLogSource(source)
      ? source.traceSourceId
      : source.kind === SourceKind.Session
        ? source.traceSourceId
        : undefined;

  const enableServiceMap = traceId && traceSourceId;

  const { data: traceSourceData } = useSource({ id: traceSourceId });

  const spanId = normalizedRow?.['__hdx_span_id'];
  const traceIdExpression =
    traceSourceData?.kind === SourceKind.Log ||
    traceSourceData?.kind === SourceKind.Trace
      ? traceSourceData.traceIdExpression
      : undefined;
  const spanIdExpression =
    traceSourceData?.kind === SourceKind.Log ||
    traceSourceData?.kind === SourceKind.Trace
      ? traceSourceData.spanIdExpression
      : undefined;

  const traceSpanRowId = useMemo(() => {
    const clauses: string[] = [];
    if (traceIdExpression && traceId) {
      clauses.push(
        SqlString.format('?=?', [SqlString.raw(traceIdExpression), traceId]),
      );
    }
    if (spanIdExpression && spanId) {
      clauses.push(
        SqlString.format('?=?', [SqlString.raw(spanIdExpression), spanId]),
      );
    }
    return clauses.length > 0 ? clauses.join(' AND ') : undefined;
  }, [traceIdExpression, traceId, spanIdExpression, spanId]);

  const handleSessionEventNavigate = useCallback(
    (rowId: string, aliasWith: WithClause[]) => {
      if (traceSourceData) {
        handleSourceStackPush({
          sourceId: traceSourceData.id,
          rowId,
          aliasWith,
          label: mainContent || 'Session Replay',
          sourceKind: traceSourceData.kind as SourceKind,
        });
      }
    },
    [traceSourceData, handleSourceStackPush, mainContent],
  );

  const { rumSessionId, rumServiceName } = useSessionId({
    sourceId: traceSourceId,
    traceId,
    dateRange: oneHourRange,
    enabled: activeRowId != null,
  });

  const hasK8sContext = useMemo(
    () => rowHasK8sContext(source, normalizedRow),
    [source, normalizedRow],
  );

  const initialRowHighlightHint = useMemo(() => {
    if (normalizedRow) {
      return {
        timestamp: normalizedRow['__hdx_timestamp'],
        spanId: normalizedRow['__hdx_span_id'],
        body: normalizedRow['__hdx_body'],
      };
    }
  }, [normalizedRow]);

  const durationMs = normalizedRow?.[ROW_DATA_ALIASES.DURATION_MS];
  const spanKind = normalizedRow?.[ROW_DATA_ALIASES.SPAN_KIND];
  const serviceName = normalizedRow?.[ROW_DATA_ALIASES.SERVICE_NAME];
  const statusCode = normalizedRow?.[ROW_DATA_ALIASES.SEVERITY_TEXT];

  const formattedDuration = useMemo(() => {
    if (durationMs == null || isNaN(Number(durationMs))) return undefined;
    return renderMs(Number(durationMs));
  }, [durationMs]);

  const spanKindLabel = useMemo(() => {
    if (spanKind == null) return undefined;
    return SPAN_KIND_LABELS[String(spanKind)] ?? String(spanKind);
  }, [spanKind]);

  const allBreadcrumbs = useMemo((): BreadcrumbItem[] => {
    const items: BreadcrumbItem[] = [];

    if (parentBreadcrumbs) {
      items.push(...parentBreadcrumbs);
    }

    const crumbSourceStack = sourceStack;
    const crumbNavStack = navStack;
    const hasStack = crumbSourceStack.length > 0 || crumbNavStack.length > 0;
    const rootLabel =
      initialMainContent ||
      (rootSource.kind === SourceKind.Trace ? 'Trace' : 'Log');

    if (hasStack) {
      items.push({
        label: rootLabel,
        sourceKind: rootSource.kind as SourceKind,
        onClick: () => handleBreadcrumbNavigation(0, 0),
      });
    }

    crumbSourceStack.forEach((entry, i) => {
      const isLeafSource = i === crumbSourceStack.length - 1;
      const isCurrent = isLeafSource && crumbNavStack.length === 0;
      items.push({
        label: entry.label,
        sourceKind: entry.sourceKind,
        onClick: isCurrent
          ? undefined
          : () => handleBreadcrumbNavigation(i + 1, 0),
      });
    });

    crumbNavStack.forEach((entry, i) => {
      const isCurrent = i === crumbNavStack.length - 1;
      items.push({
        label: entry.label,
        sourceKind: entry.sourceKind,
        onClick: isCurrent
          ? undefined
          : () => handleBreadcrumbNavigation(crumbSourceStack.length, i + 1),
      });
    });

    if (!hasStack) {
      items.push({
        label: mainContent || (sourceIsTrace ? 'Trace' : 'Log'),
        sourceKind: source.kind as SourceKind,
      });
    }

    return items;
  }, [
    sourceStack,
    navStack,
    rootSource.kind,
    sourceIsTrace,
    mainContent,
    initialMainContent,
    source.kind,
    handleBreadcrumbNavigation,
    parentBreadcrumbs,
  ]);

  const availableTabs = useMemo<Tab[]>(() => {
    const tabs: Tab[] = [];
    if (hasOverviewPanel && !sourceIsTrace) tabs.push(Tab.Overview);
    if (!sourceIsTrace) tabs.push(Tab.Parsed);
    if (sourceIsTrace) tabs.push(Tab.Trace);
    if (enableServiceMap) tabs.push(Tab.ServiceMap);
    tabs.push(Tab.Context);
    if (rumSessionId != null) tabs.push(Tab.Replay);
    if (hasK8sContext) tabs.push(Tab.Infrastructure);
    return tabs;
  }, [
    hasOverviewPanel,
    sourceIsTrace,
    enableServiceMap,
    rumSessionId,
    hasK8sContext,
  ]);

  const displayedTab = reconcileTab(persistedTab, availableTabs, defaultTab);

  if (isRowLoading || isResolvingSource) {
    return <div className={styles.loadingState}>Loading...</div>;
  }

  // The leaf cross-source frame points at a source that no longer resolves
  // (deleted / renamed / another workspace via a shared link). Render an
  // explicit message that keeps the breadcrumb trail, Back, and Close controls
  // working instead of hanging on an indefinite "Loading...".
  if (isStackSourceMissing) {
    return (
      <>
        <Box px="sm" pt="sm" pb="xs">
          <Flex align="center" justify="space-between" gap="sm" mb={8}>
            <SidePanelBreadcrumbs
              items={allBreadcrumbs}
              onBack={handlePanelBack}
            />
            <SidePanelHeaderActions
              onClose={onClose}
              isFullWidth={isFullWidth}
              onToggleFullWidth={onToggleFullWidth}
            />
          </Flex>
        </Box>
        <Box p="sm" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <Text size="sm" c="dimmed">
            This source is no longer available. It may have been deleted,
            renamed, or belong to a different workspace. Use the back button or
            the breadcrumbs above to return.
          </Text>
        </Box>
      </>
    );
  }

  if (!isRowSuccess) {
    if (isRowError && rowError) {
      return (
        <Box p="sm" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <DBRowSidePanelErrorState error={rowError} source={source} />
        </Box>
      );
    }
    return <div className={styles.loadingState}>Error loading row data</div>;
  }

  const showLogTraceActions = !sourceIsTrace && traceId && traceSourceId;

  return (
    <>
      <Box px="sm" pt="sm" pb="xs">
        <Flex align="center" justify="space-between" gap="sm" mb={8}>
          <SidePanelBreadcrumbs
            items={allBreadcrumbs}
            onBack={handlePanelBack}
          />
          <SidePanelHeaderActions
            onClose={onClose}
            isFullWidth={isFullWidth}
            onToggleFullWidth={onToggleFullWidth}
          />
        </Flex>
        <Group gap="xs" wrap="wrap">
          {!sourceIsTrace && severityText && <LogLevel level={severityText} />}
          {timestampDate && !isNaN(timestampDate.getTime()) && (
            <Text size="xs" c="dimmed">
              <FormatTime value={timestampDate} /> ·{' '}
              {formatDistanceToNowStrictShort(timestampDate)} ago
            </Text>
          )}
          {serviceName && (
            <>
              <Text size="xs" c="dimmed">
                ·
              </Text>
              <Group gap={4}>
                <Text size="xs" c="dimmed">
                  Service
                </Text>
                <Text size="xs" fw={500}>
                  {serviceName}
                </Text>
              </Group>
            </>
          )}
          {sourceIsTrace && formattedDuration && (
            <>
              <Text size="xs" c="dimmed">
                ·
              </Text>
              <Group gap={4}>
                <Text size="xs" c="dimmed">
                  Duration
                </Text>
                <Text size="xs" fw={500}>
                  {formattedDuration}
                </Text>
              </Group>
            </>
          )}
          {sourceIsTrace && statusCode && (
            <>
              <Text size="xs" c="dimmed">
                ·
              </Text>
              <Group gap={4}>
                <Text size="xs" c="dimmed">
                  Status
                </Text>
                <Text
                  size="xs"
                  fw={500}
                  c={
                    statusCode === 'Error'
                      ? 'red'
                      : statusCode === 'Ok'
                        ? 'green'
                        : undefined
                  }
                >
                  {statusCode}
                </Text>
              </Group>
            </>
          )}
          {sourceIsTrace && spanKindLabel && (
            <Badge size="sm" variant="light" radius="sm">
              {spanKindLabel}
            </Badge>
          )}
          {(sourceIsTrace ? traceId : showLogTraceActions) && (
            <>
              <Text size="xs" c="dimmed">
                ·
              </Text>
              <CopyButton value={traceId ?? ''}>
                {({ copied, copy }) => (
                  <Tooltip
                    label={copied ? 'Copied!' : 'Copy Trace ID'}
                    position="bottom"
                  >
                    <Group
                      gap={4}
                      wrap="nowrap"
                      style={{ cursor: 'pointer' }}
                      onClick={copy}
                    >
                      <IconCopy size={12} color="var(--mantine-color-dimmed)" />
                      <Text size="xs" c="dimmed">
                        Trace ID
                      </Text>
                    </Group>
                  </Tooltip>
                )}
              </CopyButton>
            </>
          )}
          {showLogTraceActions && (
            <Button
              variant="subtle"
              size="compact-xs"
              onClick={() => {
                if (traceSourceData && traceSpanRowId) {
                  handleSourceStackPush({
                    sourceId: traceSourceData.id,
                    rowId: traceSpanRowId,
                    label: mainContent || 'Log',
                    sourceKind: traceSourceData.kind as SourceKind,
                    aliasWith: [],
                  });
                }
              }}
              disabled={!traceSourceData || !traceSpanRowId}
            >
              View Trace →
            </Button>
          )}
        </Group>
        <DBRowSidePanelHeader
          attributes={highlightedAttributeValues}
          mainContent={mainContent}
          mainContentHeader={mainContentColumn}
          severityText={severityText}
          rowData={normalizedRow}
        />
      </Box>
      <TabBar
        data-testid="side-panel-tabs"
        className="fs-8 mt-2"
        items={[
          ...(hasOverviewPanel && !sourceIsTrace
            ? [
                {
                  text: 'Overview',
                  value: Tab.Overview,
                },
              ]
            : []),
          ...(!sourceIsTrace
            ? [
                {
                  text: 'Column Values',
                  value: Tab.Parsed,
                },
              ]
            : []),
          ...(sourceIsTrace
            ? [
                {
                  text: 'Trace',
                  value: Tab.Trace,
                },
              ]
            : []),
          ...(enableServiceMap
            ? [
                {
                  text: 'Service Map',
                  value: Tab.ServiceMap,
                },
              ]
            : []),
          {
            text: 'Surrounding Context',
            value: Tab.Context,
          },
          ...(rumSessionId != null
            ? [
                {
                  text: 'Session Replay',
                  value: Tab.Replay,
                },
              ]
            : []),
          ...(hasK8sContext
            ? [
                {
                  text: 'Infrastructure',
                  value: Tab.Infrastructure,
                },
              ]
            : []),
        ]}
        activeItem={displayedTab}
        onClick={(v: any) => setTab(v)}
      />
      {displayedTab === Tab.Overview && (
        <ErrorBoundary
          onError={err => {
            console.error(err);
          }}
          fallbackRender={() => (
            <div className="text-danger px-2 py-1 m-2 fs-7 font-monospace bg-danger-transparent p-4">
              An error occurred while rendering this event.
            </div>
          )}
        >
          <RowOverviewPanel
            data-testid="side-panel-tab-overview"
            source={source}
            rowId={activeRowId}
            aliasWith={activeAliasWith}
            hideHeader={true}
          />
        </ErrorBoundary>
      )}
      {displayedTab === Tab.Trace && sourceIsTrace && (
        <ErrorBoundary
          onError={err => {
            console.error(err);
          }}
          fallbackRender={() => (
            <div className="text-danger px-2 py-1 m-2 fs-7 font-monospace bg-danger-transparent p-4">
              An error occurred while rendering this event.
            </div>
          )}
        >
          <Box style={{ overflowY: 'auto' }} p="sm" h="100%">
            <DBTracePanel
              data-testid="side-panel-tab-trace"
              parentSourceId={source.id}
              childSourceId={childSourceId}
              traceId={traceId}
              dateRange={oneHourRange}
              focusDate={focusDate}
              initialRowHighlightHint={initialRowHighlightHint}
            />
          </Box>
        </ErrorBoundary>
      )}
      {displayedTab === Tab.ServiceMap && enableServiceMap && (
        <ErrorBoundary
          onError={err => {
            console.error(err);
          }}
          fallbackRender={() => (
            <div className="text-danger px-2 py-1 m-2 fs-7 font-monospace bg-danger-transparent p-4">
              An error occurred while rendering this event.
            </div>
          )}
        >
          <Flex p="sm" flex={1}>
            <ServiceMapSidePanel
              traceId={traceId}
              traceTableSourceId={traceSourceId}
              dateRange={oneHourRange}
            />
          </Flex>
        </ErrorBoundary>
      )}
      {displayedTab === Tab.Parsed && (
        <ErrorBoundary
          onError={err => {
            console.error(err);
          }}
          fallbackRender={() => (
            <div className="text-danger px-2 py-1 m-2 fs-7 font-monospace bg-danger-transparent p-4">
              An error occurred while rendering this event.
            </div>
          )}
        >
          <RowDataPanel
            data-testid="side-panel-tab-parsed"
            source={source}
            rowId={activeRowId}
            aliasWith={activeAliasWith}
          />
        </ErrorBoundary>
      )}
      {displayedTab === Tab.Context && (
        <ErrorBoundary
          onError={err => {
            console.error(err);
          }}
          fallbackRender={() => (
            <div className="text-danger px-2 py-1 m-2 fs-7 font-monospace bg-danger-transparent p-4">
              An error occurred while rendering this event.
            </div>
          )}
        >
          <ContextSubpanel
            data-testid="side-panel-tab-context"
            source={source}
            dbSqlRowTableConfig={dbSqlRowTableConfig}
            rowData={normalizedRow}
            rowId={activeRowId}
            onNavigateToRow={handleNavigateToRow}
          />
        </ErrorBoundary>
      )}
      {displayedTab === Tab.Replay && (
        <ErrorBoundary
          onError={err => {
            console.error(err);
          }}
          fallbackRender={() => (
            <div className="text-danger px-2 py-1 m-2 fs-7 font-monospace bg-danger-transparent p-4">
              An error occurred while rendering this event.
            </div>
          )}
        >
          <div
            className="overflow-hidden flex-grow-1"
            data-testid="side-panel-tab-replay"
          >
            <DBSessionPanel
              dateRange={fourHourRange}
              focusDate={focusDate}
              onEventNavigate={handleSessionEventNavigate}
              traceSourceId={traceSourceId}
              serviceName={rumServiceName}
              rumSessionId={rumSessionId}
            />
          </div>
        </ErrorBoundary>
      )}
      {displayedTab === Tab.Infrastructure && (
        <ErrorBoundary
          onError={err => {
            console.error(err);
          }}
          fallbackRender={() => (
            <div className="text-danger px-2 py-1 m-2 fs-7 font-monospace bg-danger-transparent p-4">
              An error occurred while rendering this event.
            </div>
          )}
        >
          <Box style={{ overflowY: 'auto' }} p="sm" h="100%">
            <DBInfraPanel
              data-testid="side-panel-tab-infrastructure"
              source={source}
              rowData={normalizedRow}
            />
          </Box>
        </ErrorBoundary>
      )}
    </>
  );
};

export const SidePanelErrorFallback = ({
  error,
  onClose,
}: FallbackProps & { onClose: () => void }) => (
  <Stack>
    <Group justify="flex-end" p="xs">
      <Button
        variant="subtle"
        color="gray"
        size="compact-sm"
        leftSection={<IconX size={14} />}
        onClick={onClose}
        aria-label="Close"
      >
        Close
      </Button>
    </Group>
    <div className="text-danger px-2 py-1 m-2 fs-7 font-monospace bg-danger-transparent p-4">
      An error occurred while rendering this event.
    </div>

    <div className="px-2 py-1 m-2 fs-7 font-monospace bg-body p-4">
      {error?.message}
    </div>
  </Stack>
);

export default function DBRowSidePanelErrorBoundary({
  onClose,
  rowId,
  aliasWith,
  source,
}: DBRowSidePanelProps) {
  const contextZIndex = useZIndex();
  const drawerZIndex = contextZIndex + 10;

  const { size, setSize, startResize } = useResizable(
    INITIAL_DRAWER_WIDTH_PERCENT,
  );

  const isFullWidth = size >= 99;
  const toggleFullWidth = useCallback(() => {
    setSize(isFullWidth ? INITIAL_DRAWER_WIDTH_PERCENT : 100);
  }, [isFullWidth, setSize]);

  const { clear: clearTraceWaterfallSearchState } = useWaterfallSearchState({});

  const sidePanelStack = useSidePanelStack({ initialRowId: rowId });

  const _onClose = useCallback(() => {
    // Reset the tab and navigation stacks so re-opening the drawer starts fresh.
    sidePanelStack.clearTrail();
    // Clear waterfall search state on close, so that filters don't
    // persist when reopening another trace.
    clearTraceWaterfallSearchState();
    onClose();
  }, [sidePanelStack, onClose, clearTraceWaterfallSearchState]);

  return (
    <Drawer
      opened={rowId != null}
      withCloseButton={false}
      closeOnEscape={false}
      lockScroll={false}
      withOverlay={false}
      trapFocus={false}
      onClose={_onClose}
      position="right"
      size={`${size}vw`}
      styles={{
        content: {
          border: 'none',
          boxShadow: 'var(--shadow-drawer)',
        },
        body: {
          padding: '0',
          height: '100%',
        },
      }}
      zIndex={drawerZIndex}
    >
      <ZIndexContext value={drawerZIndex}>
        <div className={styles.panel} data-testid="row-side-panel">
          <Box className={styles.panelDragBar} onMouseDown={startResize} />
          <ErrorBoundary
            fallbackRender={fallbackProps => (
              <SidePanelErrorFallback {...fallbackProps} onClose={_onClose} />
            )}
          >
            <DBRowSidePanelInner
              source={source}
              rowId={rowId}
              aliasWith={aliasWith}
              sidePanelStack={sidePanelStack}
              onClose={_onClose}
              isFullWidth={isFullWidth}
              onToggleFullWidth={toggleFullWidth}
            />
          </ErrorBoundary>
        </div>
      </ZIndexContext>
    </Drawer>
  );
}
