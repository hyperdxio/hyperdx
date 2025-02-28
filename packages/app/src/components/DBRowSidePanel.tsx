import {
  createContext,
  MouseEventHandler,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
} from 'react';
import { add } from 'date-fns';
import { isString } from 'lodash';
import { parseAsStringEnum, useQueryState } from 'nuqs';
import { ErrorBoundary } from 'react-error-boundary';
import { useHotkeys } from 'react-hotkeys-hook';
import Drawer from 'react-modern-drawer';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { Box } from '@mantine/core';
import { useClickOutside } from '@mantine/hooks';

import DBRowSidePanelHeader from '@/components/DBRowSidePanelHeader';
import { LogSidePanelKbdShortcuts } from '@/LogSidePanelElements';
import { getEventBody } from '@/source';
import TabBar from '@/TabBar';
import { SearchConfig } from '@/types';
import { useZIndex, ZIndexContext } from '@/zIndex';

import ContextSubpanel from './ContextSidePanel';
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

export default function DBRowSidePanel({
  rowId: rowId,
  source,
  // where,
  q,
  onClose,
  isNestedPanel = false,
}: {
  // where?: string;
  source: TSource;
  q?: string;
  rowId: string | undefined;
  onClose: () => void;
  isNestedPanel?: boolean;
}) {
  const contextZIndex = useZIndex();
  const drawerZIndex = contextZIndex + 10;

  const {
    data: rowData,
    isLoading: isRowLoading,
    isSuccess: isRowSuccess,
  } = useRowData({
    source,
    rowId,
  });

  const { dbSqlRowTableConfig } = useContext(RowSidePanelContext);

  enum Tab {
    Overview = 'overview',
    Parsed = 'parsed',
    Debug = 'debug',
    Trace = 'trace',
    Context = 'context',
    Replay = 'replay',
  }

  const [queryTab, setQueryTab] = useQueryState(
    'tab',
    parseAsStringEnum<Tab>(Object.values(Tab)).withDefault(Tab.Overview),
  );

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

  // const [queryTab, setQueryTab] = useQueryParam(
  //   'tb',
  //   withDefault(StringParam, undefined),
  //   {
  //     updateType: 'pushIn',
  //     // Workaround for qparams not being set properly: https://github.com/pbeshai/use-query-params/issues/233
  //     enableBatching: true,
  //   },
  // );
  // Keep track of sub-drawers so we can disable closing this root drawer
  const [subDrawerOpen, setSubDrawerOpen] = useState(false);

  const [stateTab, setStateTab] = useState<Tab>(Tab.Parsed);
  // Nested panels can't share the query param or else they'll conflict, so we'll use local state for nested panels
  // We'll need to handle this properly eventually...
  const tab = isNestedPanel ? stateTab : queryTab;
  const setTab = isNestedPanel ? setStateTab : setQueryTab;

  const displayedTab = tab;

  const _onClose = useCallback(() => {
    // Reset tab to undefined when unmounting, so that when we open the drawer again, it doesn't open to the last tab
    // (which might not be valid, ex session replay)
    if (!isNestedPanel) {
      setQueryTab(null);
    }
    onClose();
  }, [setQueryTab, isNestedPanel, onClose]);

  useHotkeys(
    ['esc'],
    () => {
      _onClose();
    },
    {
      enabled: subDrawerOpen === false,
    },
  );

  const drawerRef = useClickOutside(() => {
    if (!subDrawerOpen && rowId != null) {
      _onClose();
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

  return (
    <Drawer
      customIdSuffix={`log-side-panel-${rowId}`}
      duration={0}
      open={rowId != null}
      onClose={() => {
        if (!subDrawerOpen) {
          _onClose();
        }
      }}
      direction="right"
      size={`${Math.min(panelWidthPerc, 90)}vw`}
      zIndex={drawerZIndex}
      enableOverlay={subDrawerOpen}
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
              {/* <SidePanelHeader
                logData={logData}
                generateShareUrl={generateShareUrl}
                onPropertyAddClick={onPropertyAddClick}
                generateSearchUrl={generateSearchUrl}
                onClose={_onClose}
              /> */}
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
                  <RowOverviewPanel source={source} rowId={rowId} />
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
                  <RowDataPanel source={source} rowId={rowId} />
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
                    source={source}
                    dbSqlRowTableConfig={dbSqlRowTableConfig}
                    rowData={normalizedRow}
                    rowId={rowId}
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
                    <DBSessionPanel
                      dateRange={rng}
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
            </>
          ) : null}
        </div>
      </ZIndexContext.Provider>
    </Drawer>
  );
}
