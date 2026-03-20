import {
  createContext,
  Dispatch,
  SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { add } from 'date-fns';
import { isString } from 'lodash';
import { parseAsStringEnum, useQueryState } from 'nuqs';
import { ErrorBoundary } from 'react-error-boundary';
import { useHotkeys } from 'react-hotkeys-hook';
import SqlString from 'sqlstring';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Badge,
  Box,
  CopyButton,
  Drawer,
  Flex,
  Group,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconShare,
  IconX,
} from '@tabler/icons-react';

import useResizable from '@/hooks/useResizable';
import { WithClause } from '@/hooks/useRowWhere';
import useWaterfallSearchState from '@/hooks/useWaterfallSearchState';
import { useSource } from '@/source';
import TabBar from '@/TabBar';
import { SearchConfig } from '@/types';
import { FormatTime } from '@/useFormatTime';
import { formatDistanceToNowStrictShort } from '@/utils';
import { getHighlightedAttributesFromData } from '@/utils/highlightedAttributes';
import { useZIndex, ZIndexContext } from '@/zIndex';

import { DBHighlightedAttributesList } from '../DBHighlightedAttributesList';
import LogLevel from '../LogLevel';
import ServiceMapSidePanel from '../ServiceMap/ServiceMapSidePanel';

import ContextSubpanel from './ContextPanel';
import { getInitialDrawerWidthPercent } from './DrawerUtils';
import { ROW_DATA_ALIASES, RowDataPanel, useRowData } from './EventDataPanel';
import { RowOverviewPanel } from './EventOverviewPanel';
import { SessionReplayPanel, useSessionId } from './SessionReplayPanel';
import { LogSidePanelKbdShortcuts } from './SidePanelElements';
import TracePanel from './TracePanel';

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
  source?: TSource;
};

export const RowSidePanelContext = createContext<RowSidePanelContextProps>({});

enum Tab {
  Overview = 'overview',
  Parsed = 'parsed',
  Debug = 'debug',
  Trace = 'trace',
  ServiceMap = 'serviceMap',
  Context = 'context',
  Replay = 'replay',
}

function SidePanelHeaderActions({
  onClose,
  isFullWidth,
  onToggleFullWidth,
}: {
  onClose: () => void;
  isFullWidth?: boolean;
  onToggleFullWidth?: () => void;
}) {
  return (
    <Group gap={8} wrap="nowrap">
      <CopyButton
        value={typeof window !== 'undefined' ? window.location.href : ''}
      >
        {({ copied, copy }) => (
          <Tooltip label={copied ? 'Copied!' : 'Share link'} position="bottom">
            <ActionIcon
              variant="subtle"
              size="sm"
              onClick={copy}
              aria-label="Share"
            >
              <IconShare size={16} />
            </ActionIcon>
          </Tooltip>
        )}
      </CopyButton>
      {onToggleFullWidth && (
        <Tooltip
          label={isFullWidth ? 'Exit full width' : 'Full width'}
          position="bottom"
        >
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={onToggleFullWidth}
            aria-label={isFullWidth ? 'Exit full width' : 'Full width'}
          >
            {isFullWidth ? (
              <IconArrowsMinimize size={16} />
            ) : (
              <IconArrowsMaximize size={16} />
            )}
          </ActionIcon>
        </Tooltip>
      )}
      <Tooltip label="Close" position="bottom">
        <ActionIcon
          variant="subtle"
          size="sm"
          onClick={onClose}
          aria-label="Close"
        >
          <IconX size={16} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

type NavEntry = {
  rowId: string;
  aliasWith: WithClause[];
  label: string;
};

type BreadcrumbItem = {
  label: string;
  onClick?: () => void;
};

type EventSidePanelProps = {
  source: TSource;
  rowId: string | undefined;
  aliasWith?: WithClause[];
  onClose: () => void;
  breadcrumbs?: BreadcrumbItem[];
  initialTab?: `${Tab}`;
};

const EventSidePanel = ({
  rowId: initialRowId,
  aliasWith: initialAliasWith,
  source,
  setSubDrawerOpen,
  onClose,
  breadcrumbs,
  initialTab,
  isFullWidth,
  onToggleFullWidth,
  drawerSize,
}: EventSidePanelProps & {
  setSubDrawerOpen: Dispatch<SetStateAction<boolean>>;
  isFullWidth?: boolean;
  onToggleFullWidth?: () => void;
  drawerSize?: number;
}) => {
  const [navStack, setNavStack] = useState<NavEntry[]>([]);

  const activeRowId =
    navStack.length > 0 ? navStack[navStack.length - 1].rowId : initialRowId;
  const activeAliasWith =
    navStack.length > 0
      ? navStack[navStack.length - 1].aliasWith
      : initialAliasWith;

  const handleNavigateToRow = useCallback(
    (rowId: string, aliasWith: WithClause[], label: string) => {
      setNavStack(prev => [...prev, { rowId, aliasWith, label }]);
    },
    [],
  );

  const handleNavigateBack = useCallback(() => {
    setNavStack(prev => prev.slice(0, -1));
  }, []);

  const handleBreadcrumbClick = useCallback((targetLevel: number) => {
    setNavStack(prev => prev.slice(0, targetLevel));
  }, []);

  const {
    data: rowData,
    isLoading: isRowLoading,
    isSuccess: isRowSuccess,
  } = useRowData({
    source,
    rowId: activeRowId,
    aliasWith: activeAliasWith,
  });

  const { dbSqlRowTableConfig } = useContext(RowSidePanelContext);

  const hasOverviewPanel = useMemo(() => {
    if (
      source.resourceAttributesExpression ||
      source.eventAttributesExpression
    ) {
      return true;
    }
    return false;
  }, [source.eventAttributesExpression, source.resourceAttributesExpression]);

  const isTraceSource = source.kind === 'trace';

  const defaultTab =
    (initialTab as Tab) ??
    (isTraceSource ? Tab.Trace : hasOverviewPanel ? Tab.Overview : Tab.Parsed);

  const [queryTab, setQueryTab] = useQueryState(
    'sidePanelTab',
    parseAsStringEnum<Tab>(Object.values(Tab)).withDefault(defaultTab),
  );

  const displayedTab = queryTab;
  const setTab = setQueryTab;

  const [showTraceView, setShowTraceView] = useState(false);

  const normalizedRow = rowData?.data?.[0];
  const timestampValue = normalizedRow?.['__hdx_timestamp'];

  // TODO: Improve parsing
  let timestampDate: Date;
  if (typeof timestampValue === 'number') {
    timestampDate = new Date(timestampValue * 1000);
  } else {
    timestampDate = new Date(timestampValue);
  }

  const mainContent = isString(normalizedRow?.['__hdx_body'])
    ? normalizedRow['__hdx_body']
    : normalizedRow?.['__hdx_body'] !== undefined
      ? JSON.stringify(normalizedRow['__hdx_body'])
      : undefined;
  const severityText: string | undefined =
    normalizedRow?.['__hdx_severity_text'];

  const highlightedAttributeValues = useMemo(() => {
    const attributeExpressions: TSource['highlightedRowAttributeExpressions'] =
      [];
    if (
      (source.kind === SourceKind.Trace || source.kind === SourceKind.Log) &&
      source.highlightedRowAttributeExpressions
    ) {
      attributeExpressions.push(...source.highlightedRowAttributeExpressions);
    }

    // Add service name expression to all sources, to maintain compatibility with
    // the behavior prior to the addition of highlightedRowAttributeExpressions
    if (source.serviceNameExpression) {
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
  const traceId: string | undefined = normalizedRow?.['__hdx_trace_id'];

  const childSourceId =
    source.kind === 'log'
      ? source.traceSourceId
      : source.kind === 'trace'
        ? source.logSourceId
        : undefined;

  const traceSourceId =
    source.kind === 'trace' ? source.id : source.traceSourceId;

  const enableServiceMap = traceId && traceSourceId;

  const { data: traceSourceData } = useSource({ id: traceSourceId });

  const spanId = normalizedRow?.['__hdx_span_id'];
  const spanIdExpression = traceSourceData?.spanIdExpression;

  const traceSpanRowId = useMemo(() => {
    if (!spanIdExpression || !spanId) return undefined;
    return SqlString.format('?=?', [SqlString.raw(spanIdExpression), spanId]);
  }, [spanIdExpression, spanId]);

  const { rumSessionId, rumServiceName } = useSessionId({
    sourceId: traceSourceId,
    traceId,
    dateRange: oneHourRange,
    enabled: activeRowId != null,
  });

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
    const ms = Number(durationMs);
    if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
    if (ms < 1000) return `${ms.toFixed(2)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }, [durationMs]);

  const spanKindLabel = useMemo(() => {
    if (spanKind == null) return undefined;
    const kindMap: Record<string, string> = {
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
    return kindMap[String(spanKind)] ?? String(spanKind);
  }, [spanKind]);

  if (isRowLoading) {
    return <div className={styles.loadingState}>Loading...</div>;
  }

  if (!isRowSuccess) {
    return <div className={styles.loadingState}>Error loading row data</div>;
  }

  return (
    <>
      <Box px="sm" pt="sm" pb="xs">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <Group gap={4} mb={6}>
            {breadcrumbs.map((crumb, i) => (
              <Group key={i} gap={4}>
                {i > 0 && (
                  <Text size="xs" c="dimmed">
                    ›
                  </Text>
                )}
                {crumb.onClick ? (
                  <Text
                    size="xs"
                    c="blue"
                    style={{ cursor: 'pointer' }}
                    onClick={crumb.onClick}
                  >
                    {crumb.label}
                  </Text>
                ) : (
                  <Text size="xs" c="dimmed">
                    {crumb.label}
                  </Text>
                )}
              </Group>
            ))}
          </Group>
        )}
        <Flex
          align="center"
          justify="space-between"
          gap="sm"
          mb={navStack.length > 0 ? 4 : 8}
        >
          <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
            <Tooltip label="Back" position="bottom">
              <ActionIcon
                variant="subtle"
                size="sm"
                onClick={navStack.length > 0 ? handleNavigateBack : onClose}
                aria-label="Back"
              >
                <IconArrowLeft size={16} />
              </ActionIcon>
            </Tooltip>
            {isTraceSource ? (
              <Text size="sm" fw={600} truncate="end" style={{ minWidth: 0 }}>
                Trace: {mainContent || 'Unknown'}
              </Text>
            ) : (
              <>
                {severityText && <LogLevel level={severityText} fw={600} />}
                {severityText && mainContent && (
                  <Text size="xs" c="dimmed">
                    ·
                  </Text>
                )}
                <Text size="sm" fw={600} truncate="end" style={{ minWidth: 0 }}>
                  {mainContent || '[Empty]'}
                </Text>
              </>
            )}
          </Group>
          <SidePanelHeaderActions
            onClose={onClose}
            isFullWidth={isFullWidth}
            onToggleFullWidth={onToggleFullWidth}
          />
        </Flex>
        {navStack.length > 0 && (
          <Group gap={4} mb={4}>
            <Text
              size="xs"
              c="blue"
              style={{ cursor: 'pointer' }}
              onClick={() => setNavStack([])}
            >
              Original Event
            </Text>
            {navStack.map((entry, i) => (
              <Group key={i} gap={4}>
                <Text size="xs" c="dimmed">
                  ›
                </Text>
                {i < navStack.length - 1 ? (
                  <Text
                    size="xs"
                    c="blue"
                    style={{ cursor: 'pointer' }}
                    onClick={() => handleBreadcrumbClick(i + 1)}
                  >
                    {entry.label}
                  </Text>
                ) : (
                  <Text size="xs">{entry.label}</Text>
                )}
              </Group>
            ))}
          </Group>
        )}
        <Group gap="xs" wrap="wrap">
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
          {isTraceSource && formattedDuration && (
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
          {isTraceSource && statusCode && (
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
          {isTraceSource && spanKindLabel && (
            <Badge size="sm" variant="light" radius="sm">
              {spanKindLabel}
            </Badge>
          )}
          {!isTraceSource && traceId && traceSourceId && (
            <>
              <Text size="xs" c="dimmed">
                ·
              </Text>
              <Text
                size="xs"
                c="blue.4"
                fw={500}
                style={{ cursor: 'pointer' }}
                onClick={() => setShowTraceView(true)}
              >
                View Trace →
              </Text>
            </>
          )}
        </Group>
        {highlightedAttributeValues.length > 0 && (
          <Box mt="xs">
            <DBHighlightedAttributesList
              attributes={highlightedAttributeValues}
            />
          </Box>
        )}
      </Box>
      <TabBar
        data-testid="side-panel-tabs"
        className="fs-8 mt-2"
        items={[
          ...(hasOverviewPanel && !isTraceSource
            ? [
                {
                  text: 'Overview',
                  value: Tab.Overview,
                },
              ]
            : []),
          ...(!isTraceSource
            ? [
                {
                  text: 'Column Values',
                  value: Tab.Parsed,
                },
              ]
            : []),
          ...(isTraceSource
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
      {displayedTab === Tab.Trace && (
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
          <TracePanel
            data-testid="side-panel-tab-trace"
            parentSourceId={source.id}
            parentSource={source}
            childSourceId={childSourceId}
            traceId={traceId}
            dateRange={oneHourRange}
            focusDate={focusDate}
            initialRowHighlightHint={initialRowHighlightHint}
          />
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
          <div className="overflow-hidden flex-grow-1">
            <SessionReplayPanel
              data-testid="side-panel-tab-replay"
              dateRange={fourHourRange}
              focusDate={focusDate}
              setSubDrawerOpen={setSubDrawerOpen}
              traceSourceId={traceSourceId}
              serviceName={rumServiceName}
              rumSessionId={rumSessionId}
            />
          </div>
        </ErrorBoundary>
      )}
      <LogSidePanelKbdShortcuts />
      {!isTraceSource &&
        showTraceView &&
        traceId &&
        traceSourceData &&
        traceSpanRowId && (
          <EventSidePanelErrorBoundary
            source={traceSourceData}
            rowId={traceSpanRowId}
            onClose={() => setShowTraceView(false)}
          />
        )}
    </>
  );
};

export default function EventSidePanelErrorBoundary({
  onClose,
  rowId,
  aliasWith,
  source,
  breadcrumbs,
  initialTab,
}: EventSidePanelProps) {
  const contextZIndex = useZIndex();
  const drawerZIndex = contextZIndex + 10;

  const initialWidth = getInitialDrawerWidthPercent();
  const { size, setSize, startResize } = useResizable(initialWidth);

  const isFullWidth = size >= 99;
  const toggleFullWidth = useCallback(() => {
    setSize(isFullWidth ? getInitialDrawerWidthPercent() : 100);
  }, [isFullWidth, setSize]);

  // Keep track of sub-drawers so we can disable closing this root drawer
  const [subDrawerOpen, setSubDrawerOpen] = useState(false);

  const { isChildModalOpen } = useContext(RowSidePanelContext);

  const [_sidePanelTab, setSidePanelTab] = useQueryState(
    'sidePanelTab',
    parseAsStringEnum<Tab>(Object.values(Tab)),
  );

  // Reset tab to default when opening a different row
  useEffect(() => {
    if (rowId != null) {
      setSidePanelTab(null);
    }
  }, [rowId, setSidePanelTab]);

  const { clear: clearTraceWaterfallSearchState } = useWaterfallSearchState({});

  const _onClose = useCallback(() => {
    setSidePanelTab(null);
    clearTraceWaterfallSearchState();
    onClose();
  }, [setSidePanelTab, onClose, clearTraceWaterfallSearchState]);

  useHotkeys(['esc'], _onClose, { enabled: subDrawerOpen === false });

  return (
    <Drawer
      opened={rowId != null}
      withCloseButton={false}
      withOverlay={false}
      onClose={() => {
        if (!subDrawerOpen) {
          _onClose();
        }
      }}
      position="right"
      size={`${size}vw`}
      styles={{
        body: {
          padding: '0',
          height: '100%',
        },
      }}
      zIndex={drawerZIndex}
    >
      <ZIndexContext.Provider value={drawerZIndex}>
        <div className={styles.panel} data-testid="row-side-panel">
          <Box className={styles.panelDragBar} onMouseDown={startResize} />
          <ErrorBoundary
            fallbackRender={error => (
              <Stack>
                <div className="text-danger px-2 py-1 m-2 fs-7 font-monospace bg-danger-transparent p-4">
                  An error occurred while rendering this event.
                </div>

                <div className="px-2 py-1 m-2 fs-7 font-monospace bg-body p-4">
                  {error?.error?.message}
                </div>
              </Stack>
            )}
          >
            <EventSidePanel
              source={source}
              rowId={rowId}
              aliasWith={aliasWith}
              onClose={_onClose}
              setSubDrawerOpen={setSubDrawerOpen}
              breadcrumbs={breadcrumbs}
              initialTab={initialTab}
              isFullWidth={isFullWidth}
              onToggleFullWidth={toggleFullWidth}
              drawerSize={size}
            />
          </ErrorBoundary>
        </div>
      </ZIndexContext.Provider>
    </Drawer>
  );
}
