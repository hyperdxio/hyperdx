import * as React from 'react';
import { formatDistanceToNow } from 'date-fns';
import { format } from 'date-fns';
import { useQueryState } from 'nuqs';
import CopyToClipboard from 'react-copy-to-clipboard';
import Drawer from 'react-modern-drawer';
import { toast } from 'react-toastify';
import usePortal from 'react-useportal';
import {
  Button,
  Group,
  ScrollArea,
  Skeleton,
  Stack,
  Tabs,
} from '@mantine/core';

import api from './api';
import {
  EventTagSubpanel,
  ExceptionSubpanel,
  TraceSubpanel,
} from './LogSidePanel';
import LogTable from './LogTable';
import { HDXHistogram, HistogramResultCounter } from './SearchPage';
import { useDisplayedColumns } from './useDisplayedColumns';
import { useZIndex, ZIndexContext } from './zIndex';

import 'react-modern-drawer/dist/index.css';
import styles from '../styles/ExceptionDetailsPanel.module.scss';

const DrawerHeader = ({
  onClose,
  isLoading,
  firstException,
  logData,
}: {
  onClose: () => void;
  isLoading: boolean;
  firstException?: Record<string, any>;
  logData?: Record<string, any>;
}) => {
  const firstFrame = React.useMemo(
    () =>
      firstException?.stacktrace?.frames
        ?.reverse()
        .find((frame: any) => !!frame.filename && !!frame.lineno) ||
      firstException?.stacktrace?.frames?.[
        firstException?.stacktrace?.frames?.length - 1
      ],
    [firstException],
  );

  return (
    <div className="p-3 border-bottom border-dark">
      <Group align="flex-start" gap="md">
        <div className={styles.exceptionRowLevel} />
        <Stack gap={4} flex={1}>
          <Group>
            <strong className="text-white">
              {firstException?.type || '...'}
            </strong>

            <div className="text-slate-200 fs-8">
              {firstFrame?.filename || '...'}
              <span className="text-slate-400">{' in '}</span>
              <span className={styles.exceptionFunction}>
                {firstFrame?.function}
              </span>
              <span className="text-slate-400">{' at line '}</span>
              <span className="text-slate-300">
                {firstFrame?.lineno}:{firstFrame?.colno}
              </span>
            </div>
          </Group>
          <div className="text-slate-300 fs-8">
            {firstException?.value || '...'}
          </div>
          <Group className="text-slate-300 fs-8" mt={6} gap={6}>
            <div>{logData?._service || <Skeleton />}</div>
            <span className="text-slate-600">&middot;</span>
            {logData ? (
              <div title={logData.timestamp}>
                Last seen{' '}
                {formatDistanceToNow(new Date(logData.timestamp), {
                  addSuffix: true,
                })}
              </div>
            ) : null}
            {/* <span className="text-slate-600">&middot;</span>
            <div>
              {formatDistanceToNow(new Date(logData.firstSeen))} old
            </div> */}
          </Group>
        </Stack>
        <Group gap="xs" align="center">
          <CopyToClipboard
            text={window.location.href}
            onCopy={() => {
              toast.success('Copied link to clipboard');
            }}
          >
            <Button variant="light" color="gray" size="xs">
              Share Exception
            </Button>
          </CopyToClipboard>
          <Button
            variant="light"
            color="gray"
            size="xs"
            onClick={onClose}
            px="xs"
          >
            <i className="bi bi-x-lg" />
          </Button>
        </Group>
      </Group>
    </div>
  );
};

export const ExceptionsDetailsPane = ({
  dateRange,
}: {
  dateRange: [Date, Date];
}) => {
  const { Portal } = usePortal();

  const [exceptionGroupId, setExceptionGroupId] =
    useQueryState('exceptionGroupId');
  const [logId, setLogId] = useQueryState('logId');
  const [sortKey, setSortKey] = useQueryState('sortKey');

  const handleClose = React.useCallback(() => {
    setExceptionGroupId(null);
    setLogId(null);
    setSortKey(null);
  }, [setExceptionGroupId, setLogId, setSortKey]);

  const handleSelectLog = React.useCallback(
    (log: { id: string; sort_key: string }) => {
      setLogId(log?.id);
      setSortKey(log?.sort_key);
    },
    [setLogId, setSortKey],
  );

  const contextZIndex = useZIndex();
  const drawerZIndex = contextZIndex + 10;

  const { data: selectedLogDataRaw, isLoading } = api.useLogDetails(
    logId || '',
    sortKey || '',
    {
      enabled: logId != null,
    },
  );

  const selectedLogData = React.useMemo<any | undefined>(
    () => selectedLogDataRaw?.data[0],
    [selectedLogDataRaw],
  );

  const exceptionBreadcrumbs = React.useMemo(() => {
    try {
      return JSON.parse(
        selectedLogData?.['string.values']?.[
          selectedLogData?.['string.names']?.indexOf('breadcrumbs')
        ] ?? '[]',
      );
    } catch (e) {
      return [];
    }
  }, [selectedLogData]);

  const exceptionValues = React.useMemo<any[]>(() => {
    try {
      return JSON.parse(
        selectedLogData?.['string.values']?.[
          selectedLogData?.['string.names']?.indexOf('exception.values')
        ] ?? '[]',
      );
    } catch (e) {
      return [];
    }
  }, [selectedLogData]);

  const { displayedColumns, setDisplayedColumns } = useDisplayedColumns();

  const [highlightedTimeRange, setHighlightedTimeRange] = React.useState<
    [Date, Date] | undefined
  >();

  const handleTimeRangeSelect = (start: Date, end: Date) => {
    setHighlightedTimeRange([start, end]);
  };

  const config = React.useMemo(
    () => ({
      where: 'hyperdx_platform:"sentry" exception.values:*',
      // TODO
      // where: `exception.groupId:"${exceptionGroupId}"`,
      dateRange: highlightedTimeRange || dateRange,
    }),
    [dateRange, highlightedTimeRange],
  );

  if (!exceptionGroupId) {
    return null;
  }

  return (
    <Portal>
      <Drawer
        open={!!exceptionGroupId}
        onClose={handleClose}
        duration={0}
        direction="right"
        size="77vw"
        zIndex={drawerZIndex}
        // enableOverlay={false}
      >
        <ZIndexContext.Provider value={drawerZIndex}>
          <div className={styles.panel}>
            <DrawerHeader
              onClose={handleClose}
              isLoading={isLoading}
              firstException={exceptionValues?.[0]}
              logData={selectedLogData}
            />

            <div className="px-3 py-2 border-bottom border-dark">
              <Stack gap="xs">
                <Group>
                  <HistogramResultCounter config={config} />
                </Group>
                <div style={{ height: 80, width: '100%' }}>
                  <HDXHistogram
                    config={config}
                    onTimeRangeSelect={handleTimeRangeSelect}
                    isLive={false}
                    isUTC={false}
                  />
                </div>
              </Stack>
            </div>

            <div className={styles.panelBody}>
              <div className={styles.panelExceptionsList}>
                <div className={styles.panelExceptionsListHeader}>
                  {highlightedTimeRange ? (
                    <>
                      {format(highlightedTimeRange[0], 'MMM d HH:mm:ss')} –{' '}
                      {format(highlightedTimeRange[1], 'MMM d HH:mm:ss')}
                      <Button
                        onClick={() => setHighlightedTimeRange(undefined)}
                        variant="default"
                        size="compact-xs"
                      >
                        Clear
                      </Button>
                    </>
                  ) : (
                    <>All exceptions</>
                  )}
                </div>
                <LogTable
                  tableId="search-table"
                  isLive={false}
                  setIsUTC={() => {}}
                  onScroll={() => {}}
                  highlightedLineId={logId || undefined}
                  config={config}
                  formatUTC={false}
                  onRowExpandClick={(id, sort_key) =>
                    handleSelectLog({ id, sort_key })
                  }
                  displayedColumns={displayedColumns}
                  setDisplayedColumns={setDisplayedColumns}
                  hiddenColumns={['level', 'message', 'service']}
                  hideHeader
                  onFirstResultReceived={log => {
                    if (logId) return;
                    handleSelectLog(log);
                  }}
                />
              </div>
              <Tabs
                defaultValue="stacktrace"
                h="100%"
                flex={1}
                radius={0}
                w="100%"
                style={{ flexGrow: 0 }}
                keepMounted={false}
              >
                {isLoading || !selectedLogData ? (
                  'Loading...'
                ) : (
                  <div className={styles.panelExceptionDetails}>
                    <div className={styles.panelExceptionDetailsHeader}>
                      <div>
                        {selectedLogData &&
                          format(
                            new Date(selectedLogData?.timestamp),
                            'MMM d Y, HH:mm:ss.SSS',
                          )}
                      </div>
                    </div>

                    <Tabs.List>
                      <Tabs.Tab value="stacktrace">Stacktrace</Tabs.Tab>
                      <Tabs.Tab value="trace">Trace</Tabs.Tab>
                      <Tabs.Tab value="properties">Properties</Tabs.Tab>
                      {/* <Tabs.Tab value="session">Session Replay</Tabs.Tab> */}
                      {/* <Tabs.Tab value="k8s">K8s</Tabs.Tab> */}
                    </Tabs.List>

                    <ScrollArea h="100%" scrollbars="y">
                      <div className={styles.panelExceptionDetailsBody}>
                        <Tabs.Panel value="stacktrace">
                          <ExceptionSubpanel
                            breadcrumbs={exceptionBreadcrumbs}
                            exceptionValues={exceptionValues}
                            logData={selectedLogData}
                          />
                        </Tabs.Panel>

                        <Tabs.Panel value="properties">
                          <EventTagSubpanel
                            logData={selectedLogData}
                            onPropertyAddClick={() => {}}
                            generateSearchUrl={() => ''}
                          />
                        </Tabs.Panel>

                        <Tabs.Panel value="trace">
                          <TraceSubpanel
                            logData={selectedLogData}
                            onPropertyAddClick={() => {}}
                            generateSearchUrl={() => ''}
                            generateChartUrl={() => ''}
                            onClose={() => {}}
                            displayedColumns={[]}
                            toggleColumn={() => {}}
                          />
                        </Tabs.Panel>
                      </div>
                    </ScrollArea>
                  </div>
                )}
              </Tabs>
            </div>
          </div>
        </ZIndexContext.Provider>
      </Drawer>
    </Portal>
  );
};
