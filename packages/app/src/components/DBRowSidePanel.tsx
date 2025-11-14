import {
  createContext,
  Dispatch,
  SetStateAction,
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
import { TSource } from '@hyperdx/common-utils/dist/types';
import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { Box, Drawer, Flex, Stack } from '@mantine/core';
import { useClickOutside } from '@mantine/hooks';

import DBRowSidePanelHeader, {
  BreadcrumbNavigationCallback,
  BreadcrumbPath,
} from '@/components/DBRowSidePanelHeader';
import useResizable from '@/hooks/useResizable';
import { LogSidePanelKbdShortcuts } from '@/LogSidePanelElements';
import { getEventBody } from '@/source';
import TabBar from '@/TabBar';
import { SearchConfig } from '@/types';
import { useZIndex, ZIndexContext } from '@/zIndex';

import ServiceMapSidePanel from './ServiceMap/ServiceMapSidePanel';
import ContextSubpanel from './ContextSidePanel';
import DBInfraPanel from './DBInfraPanel';
import { RowDataPanel, useRowData } from './DBRowDataPanel';
import { RowOverviewPanel } from './DBRowOverviewPanel';
import { DBSessionPanel, useSessionId } from './DBSessionPanel';
import DBTracePanel from './DBTracePanel';

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
  isChildModalOpen?: boolean;
  setChildModalOpen?: (open: boolean) => void;
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
  Infrastructure = 'infrastructure',
}

type DBRowSidePanelProps = {
  source: TSource;
  rowId: string | undefined;
  onClose: () => void;
  isNestedPanel?: boolean;
  breadcrumbPath?: BreadcrumbPath;
  onBreadcrumbClick?: BreadcrumbNavigationCallback;
};

const DBRowSidePanel = ({
  rowId: rowId,
  source,
  isNestedPanel = false,
  setSubDrawerOpen,
  onClose,
  breadcrumbPath = [],
  onBreadcrumbClick,
}: DBRowSidePanelProps & {
  setSubDrawerOpen: Dispatch<SetStateAction<boolean>>;
}) => {
  const {
    data: rowData,
    isLoading: isRowLoading,
    isSuccess: isRowSuccess,
  } = useRowData({
    source,
    rowId,
  });

  const { dbSqlRowTableConfig } = useContext(RowSidePanelContext);

  const handleBreadcrumbClick = useCallback(
    (targetLevel: number) => {
      // Current panel's level in the hierarchy
      const currentLevel = breadcrumbPath.length;

      // The target panel level corresponds to the breadcrumb index:
      // - targetLevel 0 = root panel (breadcrumbPath.length = 0)
      // - targetLevel 1 = first nested panel (breadcrumbPath.length = 1)
      // - etc.

      // If our current level is greater than the target panel level, close this panel
      if (currentLevel > targetLevel) {
        onClose();
        onBreadcrumbClick?.(targetLevel);
      }
      // If our current level equals the target panel level, we're the target - don't close
      else if (currentLevel === targetLevel) {
        // This is the panel the user wants to navigate to - do nothing (stay open)
        return;
      }
      // If our current level is less than target, propagate up (this panel should stay open)
      else {
        onBreadcrumbClick?.(targetLevel);
      }
    },
    [breadcrumbPath.length, onBreadcrumbClick, onClose],
  );

  const hasOverviewPanel = useMemo(() => {
    if (
      source.resourceAttributesExpression ||
      source.eventAttributesExpression
    ) {
      return true;
    }
    return false;
  }, [source.eventAttributesExpression, source.resourceAttributesExpression]);

  const defaultTab =
    source.kind === 'trace'
      ? Tab.Trace
      : hasOverviewPanel
        ? Tab.Overview
        : Tab.Parsed;

  const [queryTab, setQueryTab] = useQueryState(
    'sidePanelTab',
    parseAsStringEnum<Tab>(Object.values(Tab)).withDefault(defaultTab),
  );

  const [stateTab, setStateTab] = useState<Tab>(defaultTab);
  // Nested panels can't share the query param or else they'll conflict, so we'll use local state for nested panels
  // We'll need to handle this properly eventually...
  const tab = isNestedPanel ? stateTab : queryTab;
  const setTab = isNestedPanel ? setStateTab : setQueryTab;

  const displayedTab = tab;

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
  const traceId = normalizedRow?.['__hdx_trace_id'];

  const childSourceId =
    source.kind === 'log'
      ? source.traceSourceId
      : source.kind === 'trace'
        ? source.logSourceId
        : undefined;

  const traceSourceId =
    source.kind === 'trace' ? source.id : source.traceSourceId;

  const enableServiceMap = traceId && traceSourceId;

  const { rumSessionId, rumServiceName } = useSessionId({
    sourceId: traceSourceId,
    traceId,
    dateRange: oneHourRange,
    enabled: rowId != null,
  });

  const hasK8sContext = useMemo(() => {
    try {
      if (!source?.resourceAttributesExpression || !normalizedRow) {
        return false;
      }

      const resourceAttrs = normalizedRow['__hdx_resource_attributes'];
      return (
        resourceAttrs?.['k8s.pod.uid'] != null ||
        resourceAttrs?.['k8s.node.name'] != null
      );
    } catch (e) {
      console.error(e);
      return false;
    }
  }, [source, normalizedRow]);

  const initialRowHighlightHint = useMemo(() => {
    if (normalizedRow) {
      return {
        timestamp: normalizedRow['__hdx_timestamp'],
        spanId: normalizedRow['__hdx_span_id'],
        body: normalizedRow['__hdx_body'],
      };
    }
  }, [normalizedRow]);

  if (isRowLoading) {
    return <div className={styles.loadingState}>Loading...</div>;
  }

  if (!isRowSuccess) {
    return <div className={styles.loadingState}>Error loading row data</div>;
  }

  return (
    <>
      <Box p="sm">
        <DBRowSidePanelHeader
          date={timestampDate}
          tags={tags}
          mainContent={mainContent}
          mainContentHeader={mainContentColumn}
          severityText={severityText}
          breadcrumbPath={breadcrumbPath}
          onBreadcrumbClick={handleBreadcrumbClick}
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
        data-testid="side-panel-tabs"
        className="fs-8 mt-2"
        items={[
          ...(hasOverviewPanel
            ? [
                {
                  text: 'Overview',
                  value: Tab.Overview,
                },
              ]
            : []),
          {
            text: 'Column Values',
            value: Tab.Parsed,
          },
          {
            text: 'Trace',
            value: Tab.Trace,
          },
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
            rowId={rowId}
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
            rowId={rowId}
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
            rowId={rowId}
            breadcrumbPath={breadcrumbPath}
            onBreadcrumbClick={handleBreadcrumbClick}
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
              rowId={rowId}
            />
          </Box>
        </ErrorBoundary>
      )}
      <LogSidePanelKbdShortcuts />
    </>
  );
};

export default function DBRowSidePanelErrorBoundary({
  onClose,
  rowId,
  source,
  isNestedPanel,
  breadcrumbPath = [],
  onBreadcrumbClick,
}: DBRowSidePanelProps) {
  const contextZIndex = useZIndex();
  const drawerZIndex = contextZIndex + 10;

  const initialWidth = 80;
  const { size, startResize } = useResizable(initialWidth);

  // Keep track of sub-drawers so we can disable closing this root drawer
  const [subDrawerOpen, setSubDrawerOpen] = useState(false);

  const { isChildModalOpen } = useContext(RowSidePanelContext);

  const [_, setQueryTab] = useQueryState(
    'tab',
    parseAsStringEnum<Tab>(Object.values(Tab)),
  );

  const _onClose = useCallback(() => {
    // Reset tab to undefined when unmounting, so that when we open the drawer again, it doesn't open to the last tab
    // (which might not be valid, ex session replay)
    if (!isNestedPanel) {
      setQueryTab(null);
    }
    onClose();
  }, [setQueryTab, isNestedPanel, onClose]);

  useHotkeys(['esc'], _onClose, { enabled: subDrawerOpen === false });

  const drawerRef = useClickOutside(() => {
    if (!subDrawerOpen && !isChildModalOpen && rowId != null) {
      _onClose();
    }
  }, ['mouseup', 'touchend']);

  return (
    <Drawer
      opened={rowId != null}
      withCloseButton={false}
      withinPortal={!isNestedPanel}
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
          height: '100vh',
        },
      }}
      zIndex={drawerZIndex}
    >
      <ZIndexContext.Provider value={drawerZIndex}>
        <div
          className={styles.panel}
          ref={drawerRef}
          data-testid="row-side-panel"
        >
          <Box className={styles.panelDragBar} onMouseDown={startResize} />
          <ErrorBoundary
            fallbackRender={error => (
              <Stack>
                <div className="text-danger px-2 py-1 m-2 fs-7 font-monospace bg-danger-transparent p-4">
                  An error occurred while rendering this event.
                </div>

                <div className="px-2 py-1 m-2 fs-7 font-monospace bg-dark-grey p-4">
                  {error?.error?.message}
                </div>
              </Stack>
            )}
          >
            <DBRowSidePanel
              source={source}
              rowId={rowId}
              onClose={_onClose}
              isNestedPanel={isNestedPanel}
              breadcrumbPath={breadcrumbPath}
              setSubDrawerOpen={setSubDrawerOpen}
              onBreadcrumbClick={onBreadcrumbClick}
            />
          </ErrorBoundary>
        </div>
      </ZIndexContext.Provider>
    </Drawer>
  );
}
