import {
  createContext,
  MouseEventHandler,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { add } from 'date-fns';
import { isString } from 'lodash';
import { parseAsStringEnum, useQueryState } from 'nuqs';
import { ErrorBoundary } from 'react-error-boundary';
import { useHotkeys } from 'react-hotkeys-hook';
import Drawer from 'react-modern-drawer';
import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { Box } from '@mantine/core';
import { useClickOutside } from '@mantine/hooks';

import DBRowSidePanelHeader from '@/components/DBRowSidePanelHeader';
import { LogSidePanelKbdShortcuts } from '@/LogSidePanelElements';
import { useSource } from '@/source';
import { getEventBody } from '@/source';
import TabBar from '@/TabBar';
import { SearchConfig } from '@/types';
import { useZIndex, ZIndexContext } from '@/zIndex';

import ContextSubpanel from './ContextSidePanel';
import DBInfraPanel from './DBInfraPanel';
import { RowDataPanel, useRowData } from './DBRowDataPanel';
import { RowOverviewPanel } from './DBRowOverviewPanel';
import { DBSessionPanel, useSessionId } from './DBSessionPanel';
import DBTracePanel from './DBTracePanel';

import 'react-modern-drawer/dist/index.css';
import styles from '@/../styles/LogSidePanel.module.scss';

export const RowSidePanelContext = createContext<{
  onPropertyAddClick?: (keyPath: string, value: string) => void;
  generateSearchUrl?: ({
    where,
    whereLanguage,
  }: {
    where: SearchConfig['where'];
    whereLanguage: SearchConfig['whereLanguage'];
  }) => string;
  generateChartUrl?: (config: {
    aggFn: string;
    field: string;
    groupBy: string[];
  }) => string;
  displayedColumns?: string[];
  toggleColumn?: (column: string) => void;
  shareUrl?: string;
  dbSqlRowTableConfig?: ChartConfigWithDateRange;
}>({});

type DBRowSidePanelProps = {
  source: TSource;
  rowId: string | undefined;
  zIndexOffset?: number;
  onClose: () => void;
  isTopPanel?: boolean;
};

// Hooks used in DBRowSidePanel are not allowing nullable `source` prop,
// so in order to avoid conditionally rendering hooks, we need to fetch it before
// rendering DBRowSidePanel.
export default function DBRowSidePanelWithFetcher({
  sourceId,
  ...props
}: {
  sourceId: string;
} & Omit<DBRowSidePanelProps, 'source'>) {
  const { data: source } = useSource({ id: sourceId });

  if (!source) {
    return null;
  }

  return <DBRowSidePanel {...props} source={source} />;
}

function DBRowSidePanel({
  rowId,
  source,
  onClose: _onClose,
  isTopPanel = true,
  zIndexOffset = 0,
}: DBRowSidePanelProps) {
  const contextZIndex = useZIndex();
  const drawerZIndex = contextZIndex + 10 + zIndexOffset;

  const {
    data: rowData,
    isLoading: isRowLoading,
    isSuccess: isRowSuccess,
  } = useRowData({
    source,
    rowId,
  });

  enum Tab {
    Overview = 'overview',
    Parsed = 'parsed',
    Debug = 'debug',
    Trace = 'trace',
    Context = 'context',
    Replay = 'replay',
    Infrastructure = 'infrastructure',
  }

  const [panelWidthPerc, setPanelWidthPerc] = useState(80);
  const handleResize = useCallback((e: MouseEvent) => {
    const offsetRight =
      document.body.offsetWidth - (e.clientX - document.body.offsetLeft);
    const maxWidth = document.body.offsetWidth - 25;
    setPanelWidthPerc(
      (Math.min(offsetRight + 3, maxWidth) / window.innerWidth) * 100,
    ); // ensure we bury the cursor in the panel
  }, []);
  const startResize: MouseEventHandler<HTMLDivElement> = useCallback(e => {
    e.preventDefault();
    document.addEventListener('mousemove', handleResize);
    document.addEventListener('mouseup', endResize);
  }, []);
  const endResize = useCallback(() => {
    document.removeEventListener('mousemove', handleResize);
    document.removeEventListener('mouseup', endResize);
  }, []);

  const [tab, setTab] = useQueryState(
    'tab_' + zIndexOffset,
    parseAsStringEnum<Tab>(Object.values(Tab)).withDefault(Tab.Overview),
  );

  const onClose = useCallback(() => {
    _onClose();
    setTab(null);
  }, [_onClose, setTab]);
  useHotkeys(['esc'], onClose, { enabled: isTopPanel });

  const drawerRef = useClickOutside(() => {
    if (isTopPanel && rowId != null) {
      onClose();
    }
  }, ['mouseup', 'touchend']);

  const normalizedRow = rowData?.data?.[0];
  const timestampValue = normalizedRow?.['__hdx_timestamp'];
  // TODO: Improve parsing
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
  const serviceName = normalizedRow?.['__hdx_service_name'];

  const tags = useMemo(() => {
    const tags: Record<string, string> = {};
    if (serviceName && source.serviceNameExpression) {
      tags[source.serviceNameExpression] = serviceName;
    }
    return tags;
  }, [serviceName, source.serviceNameExpression]);

  const rng = useMemo(() => {
    return [
      add(timestampDate, { minutes: -60 }),
      add(timestampDate, { minutes: 60 }),
    ] as [Date, Date];
  }, [timestampDate]);

  const focusDate = timestampDate;
  const traceId = normalizedRow?.['__hdx_trace_id'];

  const childSourceId =
    source.kind === 'log'
      ? source.traceSourceId
      : source.kind === 'trace'
        ? source.logSourceId
        : undefined;

  const traceSourceId =
    source.kind === 'trace' ? source.id : source.traceSourceId;

  const { rumSessionId, rumServiceName } = useSessionId({
    sourceId: traceSourceId,
    traceId,
    dateRange: rng,
    enabled: rowId != null,
  });

  const hasK8sContext = useMemo(() => {
    if (!source?.resourceAttributesExpression || !normalizedRow) {
      return false;
    }
    return (
      normalizedRow[source.resourceAttributesExpression]['k8s.pod.uid'] !=
        null ||
      normalizedRow[source.resourceAttributesExpression]['k8s.node.name'] !=
        null
    );
  }, [source, normalizedRow]);

  const { dbSqlRowTableConfig } = useContext(RowSidePanelContext);

  return (
    <Drawer
      customIdSuffix={`log-side-panel-${rowId}`}
      duration={0}
      open={rowId != null}
      onClose={() => {
        if (isTopPanel) {
          onClose();
        }
      }}
      direction="right"
      size={`${Math.min(panelWidthPerc, 90)}vw`}
      zIndex={drawerZIndex}
      enableOverlay={isTopPanel}
    >
      <ZIndexContext.Provider value={drawerZIndex}>
        <div className={styles.panel} ref={drawerRef}>
          <Box className={styles.panelDragBar} onMouseDown={startResize} />
          {isRowLoading && (
            <div className={styles.loadingState}>Loading...</div>
          )}
          {isRowSuccess ? (
            <>
              <Box p="sm">
                <DBRowSidePanelHeader
                  sourceId={source.id}
                  date={timestampDate}
                  tags={tags}
                  mainContent={mainContent}
                  mainContentHeader={mainContentColumn}
                  severityText={severityText}
                />
              </Box>
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
                  {
                    text: 'Trace',
                    value: Tab.Trace,
                  },
                  {
                    text: 'Surrounding Context',
                    value: Tab.Context,
                  },
                  ...(rumSessionId != null && source.sessionSourceId
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
                activeItem={tab}
                onClick={(v: any) => setTab(v)}
              />
              {tab === Tab.Overview && (
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
                  <RowOverviewPanel source={source} rowId={rowId} />
                </ErrorBoundary>
              )}
              {tab === Tab.Trace && (
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
                      parentSourceId={source.id}
                      childSourceId={childSourceId}
                      traceId={traceId}
                      dateRange={rng}
                      focusDate={focusDate}
                    />
                  </Box>
                </ErrorBoundary>
              )}
              {tab === Tab.Parsed && (
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
                  <RowDataPanel source={source} rowId={rowId} />
                </ErrorBoundary>
              )}
              {tab === Tab.Context && (
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
                    source={source}
                    dbSqlRowTableConfig={dbSqlRowTableConfig}
                    rowData={normalizedRow}
                    rowId={rowId}
                  />
                </ErrorBoundary>
              )}
              {tab === Tab.Replay && (
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
                    <DBSessionPanel
                      dateRange={rng}
                      focusDate={focusDate}
                      traceSourceId={traceSourceId}
                      serviceName={rumServiceName}
                      rumSessionId={rumSessionId}
                    />
                  </div>
                </ErrorBoundary>
              )}
              {tab === Tab.Infrastructure && (
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
                      source={source}
                      rowData={normalizedRow}
                      rowId={rowId}
                    />
                  </Box>
                </ErrorBoundary>
              )}
              <LogSidePanelKbdShortcuts />
            </>
          ) : null}
        </div>
      </ZIndexContext.Provider>
    </Drawer>
  );
}
