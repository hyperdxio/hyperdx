import {
  createContext,
  Dispatch,
  SetStateAction,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { isString } from 'lodash';
import { parseAsStringEnum, useQueryState } from 'nuqs';
import { ErrorBoundary } from 'react-error-boundary';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  isLogSource,
  isTraceSource,
  SourceKind,
  TLogSource,
  TSource,
  TTraceSource,
} from '@berg/common-utils/dist/types';
import { BuilderChartConfigWithDateRange } from '@berg/common-utils/dist/types';
import { Box, Drawer, Stack } from '@mantine/core';

import DBRowSidePanelHeader, {
  BreadcrumbNavigationCallback,
  BreadcrumbPath,
} from '@/components/DBRowSidePanelHeader';
import useResizable from '@/hooks/useResizable';
import { WithClause } from '@/hooks/useRowWhere';
import useWaterfallSearchState from '@/hooks/useWaterfallSearchState';
import { getEventBody } from '@/source';
import TabBar from '@/TabBar';
import { SearchConfig } from '@/types';
import { getHighlightedAttributesFromData } from '@/utils/highlightedAttributes';
import { useZIndex, ZIndexContext } from '@/zIndex';

import ContextSubpanel from './ContextSidePanel';
import { RowDataPanel, useRowData } from './DBRowDataPanel';
import { RowOverviewPanel } from './DBRowOverviewPanel';

// NOTE (Berg / Task 9): observability-specific side-panel tabs (trace,
// service map, session replay, k8s infra) and their stubs have been
// removed. The panel now renders only the Overview / Column Values /
// Surrounding Context tabs against any Berg Source.
const LogSidePanelKbdShortcuts = () => null;

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
  aliasWith?: WithClause[];
  onClose: () => void;
  isNestedPanel?: boolean;
  breadcrumbPath?: BreadcrumbPath;
  onBreadcrumbClick?: BreadcrumbNavigationCallback;
};

const DBRowSidePanel = ({
  rowId: rowId,
  aliasWith,
  source,
  isNestedPanel = false,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setSubDrawerOpen: _setSubDrawerOpen,
  onClose,
  breadcrumbPath,
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
    aliasWith,
  });

  const { dbSqlRowTableConfig } = useContext(RowSidePanelContext);

  const handleBreadcrumbClick = useCallback(
    (targetLevel: number) => {
      // Current panel's level in the hierarchy
      const currentLevel = breadcrumbPath?.length ?? 0;

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
    [breadcrumbPath?.length, onBreadcrumbClick, onClose],
  );

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
    }
    return false;
  }, [source]);

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

  // Berg / Task 9: trace/session replay span+/- ranges, traceId resolution,
  // service-map gating and k8s-pod context detection were observability-only
  // and have been removed along with the corresponding tabs. The Surrounding
  // Context tab still uses the row's __hdx_timestamp via ContextSubpanel.

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
          attributes={highlightedAttributeValues}
          mainContent={mainContent}
          mainContentHeader={mainContentColumn}
          severityText={severityText}
          rowData={normalizedRow}
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
      {/* Berg / Task 9: replaced the OTel-shaped tab list (Trace, Service Map,
          Session Replay, Infrastructure) with a flat row inspector. The
          surviving tabs render the row's column values + surrounding context
          rows. ARRAY/MAP/ROW types are rendered recursively by the existing
          HyperJson renderer used inside RowDataPanel. */}
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
            text: 'Surrounding Context',
            value: Tab.Context,
          },
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
            aliasWith={aliasWith}
            hideHeader={true}
          />
        </ErrorBoundary>
      )}
      {/* Berg / Task 9: Trace and ServiceMap tabs removed. */}
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
            aliasWith={aliasWith}
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
      {/* Berg / Task 9: Session Replay and Infrastructure tabs removed. */}
      <LogSidePanelKbdShortcuts />
    </>
  );
};

export default function DBRowSidePanelErrorBoundary({
  onClose,
  rowId,
  aliasWith,
  source,
  isNestedPanel,
  breadcrumbPath,
  onBreadcrumbClick,
}: DBRowSidePanelProps) {
  const contextZIndex = useZIndex();
  const drawerZIndex = contextZIndex + 10;

  const initialWidth = 80;
  const { size, startResize } = useResizable(initialWidth);

  // Keep track of sub-drawers so we can disable closing this root drawer
  const [subDrawerOpen, setSubDrawerOpen] = useState(false);

  const [_, setQueryTab] = useQueryState(
    'tab',
    parseAsStringEnum<Tab>(Object.values(Tab)),
  );

  const { clear: clearTraceWaterfallSearchState } = useWaterfallSearchState({});

  const _onClose = useCallback(() => {
    // Reset tab to undefined when unmounting, so that when we open the drawer again, it doesn't open to the last tab
    // (which might not be valid, ex session replay)
    if (!isNestedPanel) {
      setQueryTab(null);
    }
    // Clear waterfall search state on close, so that filters don't
    // persist when reopening another trace.
    clearTraceWaterfallSearchState();
    onClose();
  }, [setQueryTab, isNestedPanel, onClose, clearTraceWaterfallSearchState]);

  useHotkeys(['esc'], _onClose, { enabled: subDrawerOpen === false });

  return (
    <Drawer
      opened={rowId != null}
      withCloseButton={false}
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
            <DBRowSidePanel
              source={source}
              rowId={rowId}
              aliasWith={aliasWith}
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
