import Drawer from 'react-modern-drawer';
import { useHotkeys } from 'react-hotkeys-hook';
import { useCallback, useMemo, useState } from 'react';
import usePortal from 'react-useportal';
import stripAnsi from 'strip-ansi';

import LogSidePanel from './LogSidePanel';
import { RawLogTable } from './LogTable';
import { LogView } from './types';

import 'react-modern-drawer/dist/index.css';
import { ZIndexContext } from './zIndex';

export type Pattern = {
  pattern: string;
  count: number;
  level: string;
  id: string;
  samples: { body: string; id: string; timestamp: string; sort_key: string }[];
  service: string;
  trends: Record<string, number>;
};

export default function PatternSidePanel({
  onClose,
  pattern,
  zIndex = 100,
  config,
  selectedSavedSearch,
  onPropertyAddClick,
}: {
  config: {
    where: string;
    dateRange: [Date, Date];
  };
  selectedSavedSearch?: LogView | undefined;
  onPropertyAddClick?: (name: string, value: string | boolean | number) => void;
  pattern: Pattern;
  onClose: () => void;
  zIndex?: number;
}) {
  const { Portal } = usePortal();

  const { where: searchedQuery, dateRange: searchedTimeRange } = config;

  const [openedLog, setOpenedLog] = useState<
    { id: string; sortKey: string } | undefined
  >();

  const generateSearchUrl = useCallback(
    (newQuery?: string, newTimeRange?: [Date, Date]) => {
      const qparams = new URLSearchParams({
        q: newQuery ?? searchedQuery,
        from: newTimeRange
          ? newTimeRange[0].getTime().toString()
          : searchedTimeRange[0].getTime().toString(),
        to: newTimeRange
          ? newTimeRange[1].getTime().toString()
          : searchedTimeRange[1].getTime().toString(),
      });
      return `/search${
        selectedSavedSearch != null ? `/${selectedSavedSearch._id}` : ''
      }?${qparams.toString()}`;
    },
    [searchedQuery, searchedTimeRange, selectedSavedSearch],
  );

  const generateChartUrl = useCallback(
    ({ aggFn, field, groupBy }) => {
      return `/chart?series=${encodeURIComponent(
        JSON.stringify({
          type: 'time',
          aggFn,
          field,
          where: searchedQuery,
          groupBy,
        }),
      )}`;
    },
    [searchedQuery],
  );

  useHotkeys(
    ['esc'],
    () => {
      onClose();
    },
    {
      enabled: openedLog == null,
    },
  );

  return (
    <Drawer
      customIdSuffix={`session-side-panel-${pattern.id}`}
      duration={0}
      overlayOpacity={0.2}
      open={pattern.id != null}
      onClose={() => {
        if (!openedLog != null) {
          onClose();
        }
      }}
      direction="right"
      size={'85vw'}
      style={{ background: '#1a1d23' }}
      className="border-start border-dark"
      zIndex={zIndex}
    >
      <ZIndexContext.Provider value={zIndex}>
        <div className="p-3">
          <div className="mt-3">
            <div className="fw-bold mb-2 fs-8">Pattern</div>
            <div
              className="bg-grey p-3 overflow-auto fs-7"
              style={{ maxHeight: 300 }}
            >
              {stripAnsi(pattern.pattern)}
            </div>
          </div>
        </div>
        {openedLog != null ? (
          <Portal>
            <LogSidePanel
              logId={openedLog?.id}
              sortKey={openedLog?.sortKey}
              onClose={() => {
                setOpenedLog(undefined);
              }}
              onPropertyAddClick={onPropertyAddClick}
              generateSearchUrl={generateSearchUrl}
              generateChartUrl={generateChartUrl}
            />
          </Portal>
        ) : null}
        <div className="p-3 h-100 d-flex flex-column fs-8">
          <div className="mb-2">
            Showing a sample of {pattern.samples.length} matched logs out of ~
            {pattern.count} total
          </div>
          <RawLogTable
            logs={useMemo(
              () =>
                pattern.samples.map(sample => ({
                  ...sample,
                  severity_text: pattern.level,
                  _service: pattern.service,
                })),
              [pattern.samples, pattern.level, pattern.service],
            )}
            displayedColumns={[]}
            onRowExpandClick={useCallback(
              (id, sortKey) => {
                setOpenedLog({ id, sortKey });
              },
              [setOpenedLog],
            )}
            highlightedLineId={openedLog?.id}
            isLive={false}
            isLoading={false}
            hasNextPage={false}
            wrapLines={false}
            formatUTC={false}
            fetchNextPage={useCallback(() => {}, [])}
            onScroll={useCallback(() => {}, [])}
          />
        </div>
      </ZIndexContext.Provider>
    </Drawer>
  );
}
