import { useCallback, useMemo, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  DateRange,
  SearchCondition,
  SearchConditionLanguage,
  SourceKind,
  TSessionSource,
  TSource,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import { Box, Drawer, Flex, Stack, Text } from '@mantine/core';

import useResizable from '@/hooks/useResizable';
import { WithClause } from '@/hooks/useRowWhere';
import useWaterfallSearchState from '@/hooks/useWaterfallSearchState';
import { useZIndex, ZIndexContext } from '@/zIndex';

import {
  DBRowSidePanelInner,
  RowSidePanelContext,
  SidePanelHeaderActions,
} from './components/DBRowSidePanel';
import { getInitialDrawerWidthPercent } from './components/DrawerUtils';
import SidePanelBreadcrumbs, {
  BreadcrumbItem,
} from './components/SidePanelBreadcrumbs';
import { Session } from './sessions';
import SessionSubpanel from './SessionSubpanel';
import { formatDistanceToNowStrictShort } from './utils';

import styles from '../styles/LogSidePanel.module.scss';

type SourceStackEntry = {
  source: TSource;
  rowId: string;
  aliasWith?: WithClause[];
  label: string;
};

export default function SessionSidePanel({
  traceSource,
  sessionSource,
  sessionId,
  session,
  dateRange,
  where,
  whereLanguage,
  onLanguageChange,
  onClose,
  onPropertyAddClick,
  generateSearchUrl,
  generateChartUrl,
}: {
  traceSource: TTraceSource;
  sessionSource: TSessionSource;
  sessionId: string;
  session: Session;
  dateRange: DateRange['dateRange'];
  where?: SearchCondition;
  whereLanguage?: SearchConditionLanguage;
  onLanguageChange?: (lang: 'sql' | 'lucene') => void;
  onClose: () => void;
  onPropertyAddClick?: (name: string, value: string) => void;
  generateSearchUrl: (query?: string, timeRange?: [Date, Date]) => string;
  generateChartUrl: (config: {
    aggFn: string;
    field: string;
    groupBy: string[];
  }) => string;
}) {
  const contextZIndex = useZIndex();
  const drawerZIndex = contextZIndex + 10;

  const [subDrawerOpen, setSubDrawerOpen] = useState(false);
  const [sourceStack, setSourceStack] = useState<SourceStackEntry[]>([]);

  const initialWidth = getInitialDrawerWidthPercent();
  const { size, setSize, startResize } = useResizable(initialWidth);

  const isFullWidth = size >= 99;
  const toggleFullWidth = useCallback(() => {
    setSize(isFullWidth ? getInitialDrawerWidthPercent() : 100);
  }, [isFullWidth, setSize]);

  const { clear: clearTraceWaterfallSearchState } = useWaterfallSearchState({});

  const handleClose = useCallback(() => {
    clearTraceWaterfallSearchState();
    onClose();
  }, [onClose, clearTraceWaterfallSearchState]);

  const handleNavigateBack = useCallback(() => {
    if (sourceStack.length > 0) {
      setSourceStack(prev => prev.slice(0, -1));
    } else {
      handleClose();
    }
  }, [sourceStack.length, handleClose]);

  useHotkeys(['esc'], handleNavigateBack, {
    enabled: subDrawerOpen === false,
  });

  const sessionLabel = session?.userEmail || `Anonymous Session ${sessionId}`;

  const handleEventNavigate = useCallback(
    (rowId: string, aliasWith: WithClause[]) => {
      setSourceStack(prev => [
        ...prev,
        {
          source: traceSource as TSource,
          rowId,
          aliasWith,
          label: sessionLabel,
        },
      ]);
    },
    [traceSource, sessionLabel],
  );

  const activeSourceEntry =
    sourceStack.length > 0 ? sourceStack[sourceStack.length - 1] : null;

  const breadcrumbs = useMemo((): BreadcrumbItem[] => {
    const items: BreadcrumbItem[] = [];

    if (sourceStack.length > 0) {
      items.push({
        label: sessionLabel,
        sourceKind: SourceKind.Session,
        onClick: () => setSourceStack([]),
      });
    } else {
      items.push({
        label: sessionLabel,
        sourceKind: SourceKind.Session,
      });
    }

    return items;
  }, [sourceStack.length, sessionLabel]);

  const timeAgo = useMemo(() => {
    const maxTime =
      // eslint-disable-next-line no-restricted-syntax
      session != null ? new Date(session?.maxTimestamp) : new Date();
    return formatDistanceToNowStrictShort(maxTime);
  }, [session]);

  return (
    <Drawer
      opened={sessionId != null}
      onClose={() => {
        if (!subDrawerOpen) {
          handleNavigateBack();
        }
      }}
      position="right"
      size={`${size}vw`}
      withCloseButton={false}
      lockScroll={false}
      zIndex={drawerZIndex}
      styles={{
        content: {
          border: 'none',
          boxShadow: 'none',
        },
        body: {
          padding: '0',
          height: '100%',
        },
      }}
    >
      <ZIndexContext.Provider value={drawerZIndex}>
        <div className={styles.panel} data-testid="session-side-panel">
          <Box className={styles.panelDragBar} onMouseDown={startResize} />

          {activeSourceEntry ? (
            <RowSidePanelContext.Provider
              value={{
                isChildModalOpen: false,
                source: activeSourceEntry.source,
              }}
            >
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
                <DBRowSidePanelInner
                  source={activeSourceEntry.source}
                  rowId={activeSourceEntry.rowId}
                  aliasWith={activeSourceEntry.aliasWith}
                  onClose={handleClose}
                  onNavigateToParent={() => setSourceStack([])}
                  setSubDrawerOpen={setSubDrawerOpen}
                  isFullWidth={isFullWidth}
                  onToggleFullWidth={toggleFullWidth}
                  drawerSize={size}
                  parentBreadcrumbs={[
                    {
                      label: sessionLabel,
                      sourceKind: SourceKind.Session,
                      onClick: () => setSourceStack([]),
                    },
                  ]}
                />
              </ErrorBoundary>
            </RowSidePanelContext.Provider>
          ) : (
            <>
              <Box px="sm" pt="sm" pb="xs">
                <Flex align="center" justify="space-between" gap="sm" mb={8}>
                  <SidePanelBreadcrumbs
                    items={breadcrumbs}
                    isFullWidth={isFullWidth}
                    onToggleFullWidth={toggleFullWidth}
                  />
                  <SidePanelHeaderActions onClose={handleClose} />
                </Flex>
                <Text size="xs" c="dimmed">
                  Last active {timeAgo} ago
                  {Number.parseInt(session?.errorCount ?? '0') > 0 && (
                    <>
                      {' · '}
                      <Text component="span" size="xs" c="red">
                        {session?.errorCount} Errors
                      </Text>
                    </>
                  )}
                  {' · '}
                  {session?.sessionCount} Events
                </Text>
              </Box>

              <div className="d-flex flex-column overflow-hidden flex-grow-1">
                <SessionSubpanel
                  traceSource={traceSource}
                  sessionSource={sessionSource}
                  session={session}
                  start={dateRange[0]}
                  end={dateRange[1]}
                  rumSessionId={sessionId}
                  onPropertyAddClick={onPropertyAddClick}
                  generateSearchUrl={generateSearchUrl}
                  generateChartUrl={generateChartUrl}
                  setDrawerOpen={setSubDrawerOpen}
                  onEventNavigate={handleEventNavigate}
                  where={where}
                  whereLanguage={whereLanguage}
                  onLanguageChange={onLanguageChange}
                />
              </div>
            </>
          )}
        </div>
      </ZIndexContext.Provider>
    </Drawer>
  );
}
