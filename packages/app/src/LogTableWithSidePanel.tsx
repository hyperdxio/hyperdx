import { useCallback, useState } from 'react';
import usePortal from 'react-useportal';

import LogSidePanel from './LogSidePanel';
import LogTable from './LogTable';
import type { LogView } from './types';
import { useDisplayedColumns } from './useDisplayedColumns';

export function LogTableWithSidePanel({
  config,
  isLive,
  onScroll,
  selectedSavedSearch,
  onPropertySearchClick,
  onRowExpandClick,
  onPropertyAddClick,
  onSettled,
  columnNameMap,
  showServiceColumn,
}: {
  config: {
    where: string;
    dateRange: [Date, Date];
    columns?: string[];
  };
  isLive: boolean;
  columnNameMap?: Record<string, string>;
  showServiceColumn?: boolean;

  onPropertySearchClick: (
    property: string,
    value: string | number | boolean,
  ) => void;

  onPropertyAddClick?: (name: string, value: string | boolean | number) => void;
  onRowExpandClick?: (logId: string, sortKey: string) => void;
  onScroll?: (scrollTop: number) => void | undefined;
  selectedSavedSearch?: LogView | undefined;

  onSettled?: () => void;
}) {
  const { where: searchedQuery, dateRange: searchedTimeRange } = config;

  const [openedLog, setOpenedLog] = useState<
    { id: string; sortKey: string } | undefined
  >();

  // Needed as sometimes the side panel will be contained with some
  // weird positioning and it breaks the slideout
  const { Portal } = usePortal();

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
    ({ aggFn, field, groupBy }: any) => {
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

  const voidFn = useCallback(() => {}, []);

  const { displayedColumns, setDisplayedColumns, toggleColumn } =
    useDisplayedColumns(config.columns);

  return (
    <>
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
            displayedColumns={displayedColumns}
            toggleColumn={toggleColumn}
          />
        </Portal>
      ) : null}
      <LogTable
        isLive={isLive}
        onScroll={onScroll ?? voidFn}
        highlightedLineId={openedLog?.id}
        config={config}
        onPropertySearchClick={onPropertySearchClick}
        onRowExpandClick={useCallback(
          (id: string, sortKey: string) => {
            setOpenedLog({ id, sortKey });
            onRowExpandClick?.(id, sortKey);
          },
          [setOpenedLog, onRowExpandClick],
        )}
        onEnd={onSettled}
        displayedColumns={displayedColumns}
        setDisplayedColumns={setDisplayedColumns}
        columnNameMap={columnNameMap}
        showServiceColumn={showServiceColumn}
      />
    </>
  );
}
