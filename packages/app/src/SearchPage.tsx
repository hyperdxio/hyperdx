import {
  FormEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { clamp, format, sub } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { debounce } from 'lodash';
import { Button } from 'react-bootstrap';
import { ErrorBoundary } from 'react-error-boundary';
import { useHotkeys } from 'react-hotkeys-hook';
import { toast } from 'react-toastify';
import {
  Bar,
  BarChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  StringParam,
  useQueryParam,
  useQueryParams,
  withDefault,
} from 'use-query-params';
import { ActionIcon, Indicator } from '@mantine/core';

import api from './api';
import CreateLogAlertModal from './CreateLogAlertModal';
import { withAppNav } from './layout';
import LogSidePanel from './LogSidePanel';
import LogTable from './LogTable';
import { MemoPatternTableWithSidePanel } from './PatternTableWithSidePanel';
import SaveSearchModal from './SaveSearchModal';
import SearchInput from './SearchInput';
import SearchPageActionBar from './SearchPageActionBar';
import SearchTimeRangePicker from './SearchTimeRangePicker';
import { Tags } from './Tags';
import { useTimeQuery } from './timeQuery';
import { useDisplayedColumns } from './useDisplayedColumns';

import 'react-modern-drawer/dist/index.css';

const formatDate = (
  date: Date,
  isUTC: boolean,
  strFormat = 'MMM d HH:mm:ss',
) => {
  return isUTC
    ? formatInTimeZone(date, 'Etc/UTC', strFormat)
    : format(date, strFormat);
};
const dateRangeToString = (range: [Date, Date], isUTC: boolean) => {
  return `${formatDate(range[0], isUTC)} - ${formatDate(range[1], isUTC)}`;
};

const HistogramBarChartTooltip = (props: any) => {
  const tsFormat = 'MMM d HH:mm:ss.SSS';
  const { active, payload, label } = props;
  if (active && payload && payload.length) {
    return (
      <div className="bg-grey px-3 py-2 rounded fs-8">
        <div className="mb-2">
          {formatDate(new Date(label * 1000), props.isUTC, tsFormat)}
        </div>
        {payload.map((p: any) => (
          <div key={p.name} style={{ color: p.color }}>
            {p.dataKey === 'error' ? 'Errors' : 'Other'}: {p.value} lines
          </div>
        ))}
      </div>
    );
  }
  return null;
};

const HDXHistogram = memo(
  ({
    config: { dateRange, where },
    onTimeRangeSelect,
    isLive,
    isUTC,
  }: {
    config: {
      dateRange: [Date, Date];
      where: string;
    };
    onTimeRangeSelect: (start: Date, end: Date) => void;
    isLive: boolean;
    isUTC: boolean;
  }) => {
    const { data: histogramResults, isLoading: isHistogramResultsLoading } =
      api.useLogHistogram(
        where,
        dateRange?.[0] ?? new Date(),
        dateRange?.[1] ?? new Date(),
        {
          keepPreviousData: isLive,
          staleTime: 1000 * 60 * 5,
          refetchOnWindowFocus: false,
        },
      );

    const data = useMemo(() => {
      const buckets = new Map();
      for (const row of histogramResults?.data ?? []) {
        buckets.set(row.ts_bucket, {
          ...buckets.get(row.ts_bucket),
          [row.severity_group === '' ? 'info' : row.severity_group]: row.count,
          ts_bucket: row.ts_bucket,
        });
      }
      return Array.from(buckets.values());
    }, [histogramResults]);

    const tsInterval =
      ((data?.[1]?.ts_bucket ?? 0) - (data?.[0]?.ts_bucket ?? 0)) * 1000;

    const [highlightStart, setHighlightStart] = useState<string | undefined>();
    const [highlightEnd, setHighlightEnd] = useState<string | undefined>();

    return isHistogramResultsLoading ? (
      <div className="w-100 h-100 d-flex align-items-center justify-content-center">
        Loading Graph...
      </div>
    ) : (
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart
          syncId="hdx"
          syncMethod="value"
          width={500}
          height={300}
          data={data}
          className="user-select-none cursor-crosshair"
          onMouseLeave={e => {
            setHighlightStart(undefined);
            setHighlightEnd(undefined);
          }}
          onMouseDown={e => e != null && setHighlightStart(e.activeLabel)}
          onMouseMove={e => highlightStart && setHighlightEnd(e.activeLabel)}
          onMouseUp={e => {
            if (e?.activeLabel != null && highlightStart === e.activeLabel) {
              setHighlightStart(undefined);
              setHighlightEnd(undefined);

              return onTimeRangeSelect(
                new Date(
                  Number.parseInt(highlightStart ?? e.activeLabel) * 1000,
                ),
                new Date(
                  Number.parseInt(highlightEnd ?? e.activeLabel) * 1000 +
                    tsInterval,
                ),
              );
            }
            if (highlightStart != null && highlightEnd != null) {
              try {
                onTimeRangeSelect(
                  new Date(
                    Number.parseInt(
                      highlightStart <= highlightEnd
                        ? highlightStart
                        : highlightEnd,
                    ) * 1000,
                  ),
                  new Date(
                    Number.parseInt(
                      highlightEnd >= highlightStart
                        ? highlightEnd
                        : highlightStart,
                    ) * 1000,
                  ),
                );
              } catch (e) {
                console.error('failed to highlight range', e);
              }
              setHighlightStart(undefined);
              setHighlightEnd(undefined);
            }
          }}
        >
          <XAxis
            dataKey={'ts_bucket'}
            domain={[
              dateRange[0].getTime() / 1000,
              dateRange[1].getTime() / 1000,
            ]}
            interval="preserveStartEnd"
            scale="time"
            type="number"
            tickFormatter={tick =>
              formatDate(new Date(tick * 1000), isUTC, 'MMM d HH:mm')
            }
            minTickGap={50}
            tick={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace' }}
          />
          <YAxis
            width={35}
            minTickGap={25}
            tickFormatter={(value: number) =>
              new Intl.NumberFormat('en-US', {
                notation: 'compact',
                compactDisplay: 'short',
              }).format(value)
            }
            tick={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace' }}
          />
          <Tooltip content={<HistogramBarChartTooltip isUTC={isUTC} />} />
          <Bar dataKey="info" stackId="a" fill="#50FA7B" maxBarSize={24} />
          <Bar dataKey="error" stackId="a" fill="#FF5D5B" maxBarSize={24} />
          {highlightStart && highlightEnd ? (
            <ReferenceArea
              // yAxisId="1"
              x1={highlightStart}
              x2={highlightEnd}
              strokeOpacity={0.3}
            />
          ) : null}
        </BarChart>
      </ResponsiveContainer>
    );
  },
);

const HistogramResultCounter = ({
  config: { dateRange, where },
}: {
  config: { dateRange: [Date, Date]; where: string };
}) => {
  const { data: histogramResults, isLoading: isHistogramResultsLoading } =
    api.useLogHistogram(
      where,
      dateRange?.[0] ?? new Date(),
      dateRange?.[1] ?? new Date(),
      {
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
      },
    );

  return (
    <>
      {histogramResults != null ? (
        <>
          {histogramResults?.data?.reduce(
            (p: number, v: any) => p + Number.parseInt(v.count),
            0,
          )}{' '}
          Results
        </>
      ) : null}
    </>
  );
};

const LogViewerContainer = memo(function LogViewerContainer({
  onPropertySearchClick,
  onPropertyAddClick,
  config,
  generateSearchUrl,
  generateChartUrl,
  isLive,
  setIsLive,
  isUTC,
  setIsUTC,
  onShowPatternsClick,
}: {
  config: {
    where: string;
    dateRange: [Date, Date];
  };
  onPropertySearchClick: (
    name: string,
    value: string | boolean | number,
  ) => void;
  generateSearchUrl: (query?: string, timeRange?: [Date, Date]) => string;
  generateChartUrl: (config: {
    aggFn: string;
    field: string;
    groupBy: string[];
  }) => string;
  onPropertyAddClick: (name: string, value: string | boolean | number) => void;
  isLive: boolean;
  setIsLive: (isLive: boolean) => void;
  isUTC: boolean;
  setIsUTC: (isUTC: boolean) => void;
  onShowPatternsClick: () => void;
}) {
  const [openedLogQuery, setOpenedLogQuery] = useQueryParams(
    {
      lid: withDefault(StringParam, undefined),
      sk: withDefault(StringParam, undefined),
    },
    {
      updateType: 'pushIn',
      enableBatching: true,
    },
  );

  const openedLog = useMemo(() => {
    if (openedLogQuery.lid != null && openedLogQuery.sk != null) {
      return {
        id: openedLogQuery.lid,
        sortKey: openedLogQuery.sk,
      };
    }
    return undefined;
  }, [openedLogQuery]);

  const setOpenedLog = useCallback(
    (log: { id: string; sortKey: string } | undefined) => {
      if (log == null || openedLog?.id === log.id) {
        setOpenedLogQuery({ lid: undefined, sk: undefined });
      } else {
        setOpenedLogQuery({ lid: log.id, sk: log.sortKey });
      }
    },
    [openedLog, setOpenedLogQuery],
  );

  const { displayedColumns, setDisplayedColumns, toggleColumn } =
    useDisplayedColumns();

  return (
    <>
      <ErrorBoundary
        onError={err => {
          console.error(err);
        }}
        fallbackRender={() => (
          <div className="text-danger px-2 py-1 m-2 fs-7 font-monospace bg-danger-transparent">
            An error occurred while rendering the event details. Contact support
            for more help.
          </div>
        )}
      >
        <LogSidePanel
          key={openedLog?.id}
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
      </ErrorBoundary>
      <LogTable
        tableId="search-table"
        isLive={isLive}
        setIsUTC={setIsUTC}
        onScroll={useCallback(
          (scrollTop: number) => {
            // If the user scrolls a bit down, kick out of live mode
            if (scrollTop > 16) {
              setIsLive(false);
            }
          },
          [setIsLive],
        )}
        highlightedLineId={openedLog?.id}
        config={config}
        onPropertySearchClick={onPropertySearchClick}
        formatUTC={isUTC}
        onRowExpandClick={useCallback(
          (id: string, sortKey: string) => {
            setOpenedLog({ id, sortKey });
            setIsLive(false);
          },
          [setOpenedLog, setIsLive],
        )}
        onShowPatternsClick={onShowPatternsClick}
        displayedColumns={displayedColumns}
        setDisplayedColumns={setDisplayedColumns}
      />
    </>
  );
});

function SearchPage() {
  const router = useRouter();
  const savedSearchId = router.query.savedSearchId;

  const [resultsMode, setResultsMode] = useState<'search' | 'patterns'>(
    'search',
  );

  const [isUTC, setIsUTC] = useState(false);
  const {
    isReady,
    isLive,
    searchedTimeRange,
    displayedTimeInputValue,
    setDisplayedTimeInputValue,
    onSearch,
    setIsLive,
    onTimeRangeSelect,
  } = useTimeQuery({ isUTC });

  const [isFirstLoad, setIsFirstLoad] = useState(true);
  useEffect(() => {
    setIsFirstLoad(false);
  }, []);
  const [_searchedQuery, setSearchedQuery] = useQueryParam(
    'q',
    withDefault(StringParam, undefined),
    {
      // prevent hijacking browser back button
      updateType: isFirstLoad ? 'replaceIn' : 'pushIn',
      // Workaround for qparams not being set properly: https://github.com/pbeshai/use-query-params/issues/233
      enableBatching: true,
    },
  );
  // Allows us to determine if the user has changed the search query
  const searchedQuery = _searchedQuery ?? '';

  // TODO: Set displayed query to qparam... in a less bad way?
  useEffect(() => {
    setDisplayedSearchQuery(searchedQuery);
  }, [searchedQuery]);

  const [displayedSearchQuery, setDisplayedSearchQuery] = useState('');

  const doSearch = useCallback(
    (query: string, timeQuery: string) => {
      onSearch(timeQuery);

      setSearchedQuery(query);
    },
    [setSearchedQuery, onSearch],
  );

  const onSearchSubmit = useCallback(
    debounce(
      () => {
        doSearch(displayedSearchQuery, displayedTimeInputValue);
      },
      300,
      {
        leading: true,
        trailing: false,
      },
    ),
    [doSearch, displayedSearchQuery, displayedTimeInputValue],
  );

  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    searchInput.current?.focus();
  }, [searchInput]);
  useHotkeys(
    '/',
    () => {
      searchInput.current?.focus();
    },
    { preventDefault: true },
    [searchInput],
  );

  const [saveSearchModalMode, setSaveSearchModalMode] = useState<
    'update' | 'save' | 'hidden'
  >('hidden');
  const [configAlertModalShow, setConfigAlertModalShow] = useState(false);
  const deleteLogView = api.useDeleteLogView();
  const updateLogView = api.useUpdateLogView();
  const {
    data: logViewsData,
    isLoading: isLogViewsLoading,
    refetch: refetchLogViews,
  } = api.useLogViews();
  const logViews = useMemo(() => logViewsData?.data ?? [], [logViewsData]);

  const selectedSavedSearch = logViews.find(v => v._id === savedSearchId);

  // Populate searched query with saved query if searched query is unset (initial load)
  useEffect(() => {
    if (selectedSavedSearch != null && _searchedQuery == null) {
      setSearchedQuery(selectedSavedSearch?.query);
    }
  }, [selectedSavedSearch, setSearchedQuery, _searchedQuery]);

  useHotkeys(
    ['ctrl+s', 'meta+s'],
    () => {
      setSaveSearchModalMode('save');
    },
    {
      preventDefault: true,
      enableOnFormTags: true,
    },
    [setSaveSearchModalMode],
  );

  const onClickDeleteLogView = () => {
    if (selectedSavedSearch?._id) {
      deleteLogView.mutate(selectedSavedSearch._id, {
        onSuccess: () => {
          toast.success('Saved search deleted.');
          router.push(`/search`);
          refetchLogViews();
        },
        onError: () => {
          toast.error(
            'An error occurred. Please contact support for more details.',
          );
        },
      });
    }
  };

  const onClickUpdateLogView = () => {
    if (selectedSavedSearch?._id && displayedSearchQuery) {
      updateLogView.mutate(
        { id: selectedSavedSearch._id, query: displayedSearchQuery },
        {
          onSuccess: () => {
            toast.success('Saved search updated.');
            refetchLogViews();
          },
          onError: () => {
            toast.error(
              'An error occurred. Please contact support for more details.',
            );
          },
        },
      );
    }
  };

  const onClickConfigAlert = () => {
    setConfigAlertModalShow(true);
  };
  // ***********************************************************************

  const onPropertySearchClick = useCallback(
    (name: string, value: string | number | boolean) => {
      const searchQuery = `${name}:${
        typeof value === 'string' ? `"${value}"` : value
      }`;
      doSearch(searchQuery, displayedTimeInputValue);
      setDisplayedSearchQuery(searchQuery);
    },
    [setDisplayedSearchQuery, doSearch, displayedTimeInputValue],
  );

  const generateSearchUrl = useCallback(
    (newQuery?: string, newTimeRange?: [Date, Date], lid?: string) => {
      const fromDate = newTimeRange ? newTimeRange[0] : searchedTimeRange[0];
      const toDate = newTimeRange ? newTimeRange[1] : searchedTimeRange[1];
      const qparams = new URLSearchParams({
        q: newQuery ?? searchedQuery,
        from: fromDate.getTime().toString(),
        to: toDate.getTime().toString(),
        tq: dateRangeToString([fromDate, toDate], isUTC),
        ...(lid ? { lid } : {}),
      });
      return `/search${
        selectedSavedSearch != null ? `/${selectedSavedSearch._id}` : ''
      }?${qparams.toString()}`;
    },
    [searchedQuery, searchedTimeRange, selectedSavedSearch, isUTC],
  );

  const generateChartUrl = useCallback(
    ({ aggFn, field, groupBy, table }: any) => {
      return `/chart?series=${encodeURIComponent(
        JSON.stringify({
          aggFn,
          field,
          groupBy,
          table,
          type: 'time',
          where: searchedQuery,
        }),
      )}`;
    },
    [searchedQuery],
  );

  const onPropertyAddClick = useCallback(
    (name: string, value: string | number | boolean) => {
      const searchQuery = `${name}:${
        typeof value === 'string' ? `"${value}"` : value
      }`;
      setDisplayedSearchQuery(v => v + (v.length > 0 ? ' ' : '') + searchQuery);
    },
    [setDisplayedSearchQuery],
  );

  const chartsConfig = useMemo(() => {
    return {
      where: searchedQuery,
      dateRange: [
        searchedTimeRange[0] ?? new Date(),
        searchedTimeRange[1] ?? new Date(),
      ] as [Date, Date],
    };
  }, [searchedQuery, searchedTimeRange]);

  const [zoomOutFrom, zoomOutTo, zoomInFrom, zoomInTo] = useMemo(() => {
    if (searchedTimeRange[0] == null || searchedTimeRange[1] == null) {
      return [new Date(), new Date(), new Date(), new Date()];
    }

    const rangeMs =
      searchedTimeRange[1].getTime() - searchedTimeRange[0].getTime();
    const qtrRangeSec = Math.max(Math.round(rangeMs / 1000 / 4), 1);

    const zoomOutFrom = sub(searchedTimeRange[0] ?? new Date(), {
      seconds: qtrRangeSec,
    });
    const zoomOutTo = clamp(
      sub(searchedTimeRange[1] ?? new Date(), {
        seconds: -qtrRangeSec,
      }),
      {
        start: zoomOutFrom,
        end: new Date(),
      },
    );

    const zoomInFrom = sub(searchedTimeRange[0] ?? new Date(), {
      seconds: -qtrRangeSec,
    });
    const zoomInTo = clamp(
      sub(searchedTimeRange[1] ?? new Date(), {
        seconds: qtrRangeSec,
      }),
      {
        start: zoomInFrom,
        end: new Date(),
      },
    );

    return [zoomOutFrom, zoomOutTo, zoomInFrom, zoomInTo];
  }, [searchedTimeRange]);

  // This ensures we only render this conditionally on the client
  // otherwise we get SSR hydration issues
  const [shouldShowLiveModeHint, setShouldShowLiveModeHint] = useState(false);
  useEffect(() => {
    setShouldShowLiveModeHint(isLive === false);
  }, [isLive]);

  const onShowEventsClick = useCallback(() => {
    setResultsMode('search');
  }, [setResultsMode]);

  const handleUpdateTags = useCallback(
    (newTags: string[]) => {
      if (selectedSavedSearch?._id) {
        updateLogView.mutate(
          {
            id: selectedSavedSearch?._id,
            query: displayedSearchQuery,
            tags: newTags,
          },
          {
            onSuccess: () => {
              refetchLogViews();
            },
            onError: () => {
              toast.error(
                'An error occurred. Please contact support for more details.',
              );
            },
          },
        );
      }
    },
    [
      displayedSearchQuery,
      refetchLogViews,
      selectedSavedSearch?._id,
      updateLogView,
    ],
  );
  const tagsCount = selectedSavedSearch?.tags?.length || 0;

  return (
    <div style={{ height: '100vh' }}>
      <Head>
        <title>Search - HyperDX</title>
      </Head>
      <SaveSearchModal
        mode={saveSearchModalMode}
        onHide={() => setSaveSearchModalMode('hidden')}
        searchQuery={displayedSearchQuery}
        searchName={selectedSavedSearch?.name ?? ''}
        searchID={selectedSavedSearch?._id ?? ''}
        onSaveSuccess={responseData => {
          toast.success('Saved search created');
          router.push(
            `/search/${responseData._id}?${new URLSearchParams({
              q: searchedQuery,
              ...(isLive
                ? {}
                : {
                    from: searchedTimeRange[0].getTime().toString(),
                    to: searchedTimeRange[1].getTime().toString(),
                  }),
            }).toString()}`,
          );
          refetchLogViews();
          setSaveSearchModalMode('hidden');
        }}
        onUpdateSuccess={responseData => {
          toast.success('Saved search renamed');
          refetchLogViews();
          setSaveSearchModalMode('hidden');
        }}
      />
      <CreateLogAlertModal
        show={configAlertModalShow}
        onHide={() => setConfigAlertModalShow(false)}
        savedSearch={selectedSavedSearch}
        query={selectedSavedSearch?.query ?? displayedSearchQuery}
        onSaveSuccess={() => {
          toast.success('Alerts updated successfully.');
          refetchLogViews();
        }}
        onDeleteSuccess={() => {
          toast.success('Alert deleted successfully.');
          refetchLogViews();
        }}
        onSavedSearchCreateSuccess={responseData => {
          router.push(
            `/search/${responseData._id}?${new URLSearchParams({
              q: searchedQuery,
              ...(isLive
                ? {}
                : {
                    from: searchedTimeRange[0].getTime().toString(),
                    to: searchedTimeRange[1].getTime().toString(),
                  }),
            }).toString()}`,
          );
          refetchLogViews();
        }}
      />
      <div className="d-flex flex-column flex-grow-1 bg-hdx-dark h-100">
        <div className="bg-body pb-3 pt-3 d-flex px-3 align-items-center">
          <form
            onSubmit={e => {
              e.preventDefault();
              onSearchSubmit();
            }}
            className="d-flex flex-grow-1"
          >
            <SearchInput
              inputRef={searchInput}
              value={displayedSearchQuery}
              onChange={useCallback(
                q => setDisplayedSearchQuery(q),
                [setDisplayedSearchQuery],
              )}
              onSearch={(searchQuery: string) =>
                doSearch(searchQuery, displayedTimeInputValue)
              }
            />
            <div
              className="ms-2 w-100 d-flex"
              style={{ maxWidth: 360, height: 36 }}
            >
              <SearchTimeRangePicker
                inputValue={displayedTimeInputValue}
                setInputValue={setDisplayedTimeInputValue}
                onSearch={rangeStr => {
                  doSearch(displayedSearchQuery, rangeStr);
                }}
                showLive={resultsMode === 'search'}
              />
            </div>
            <input
              type="submit"
              value="Search"
              style={{
                width: 0,
                height: 0,
                border: 0,
                padding: 0,
              }}
            />
          </form>
          <SearchPageActionBar
            key={`${savedSearchId}`}
            onClickConfigAlert={onClickConfigAlert}
            onClickDeleteLogView={onClickDeleteLogView}
            onClickUpdateLogView={onClickUpdateLogView}
            selectedLogView={selectedSavedSearch}
            onClickRenameSearch={() => {
              setSaveSearchModalMode('update');
            }}
            onClickSaveSearch={() => {
              setSaveSearchModalMode('save');
            }}
          />
          {!!selectedSavedSearch && (
            <Tags
              allowCreate
              values={selectedSavedSearch.tags || []}
              onChange={handleUpdateTags}
            >
              <Indicator
                label={tagsCount || '+'}
                size={20}
                color="gray"
                withBorder
                zIndex={1}
              >
                <ActionIcon size="lg" variant="default" ml="xs">
                  <i className="bi bi-tags-fill text-slate-300"></i>
                </ActionIcon>
              </Indicator>
            </Tags>
          )}
        </div>
        <div className="d-flex mx-4 mt-2 justify-content-between">
          <div className="fs-8 text-muted">
            {isReady ? (
              <HistogramResultCounter
                config={{
                  where: searchedQuery,
                  dateRange: [
                    searchedTimeRange[0] ?? new Date(),
                    searchedTimeRange[1] ?? new Date(),
                  ],
                }}
              />
            ) : null}
          </div>
          <div className="d-flex">
            <Link
              href={generateSearchUrl(searchedQuery, [zoomOutFrom, zoomOutTo])}
              className="text-muted-hover text-decoration-none fs-8 me-3"
            >
              <i className="bi bi-zoom-out me-1"></i>Zoom Out
            </Link>
            <Link
              href={generateSearchUrl(searchedQuery, [zoomInFrom, zoomInTo])}
              className="text-muted-hover text-decoration-none fs-8 me-3"
            >
              <i className="bi bi-zoom-in me-1"></i>Zoom In
            </Link>
            <Link
              href={generateChartUrl({
                table: 'logs',
                aggFn: 'count',
                field: undefined,
                groupBy: ['level'],
              })}
              className="text-muted-hover text-decoration-none fs-8"
            >
              <i className="bi bi-plus-circle me-1"></i>Create Chart
            </Link>
          </div>
        </div>
        <div style={{ height: 110 }} className="my-2 px-3 w-100">
          {/* Hack, recharts will release real fix soon https://github.com/recharts/recharts/issues/172 */}
          <div
            style={{
              position: 'relative',
              width: '100%',
              paddingBottom: '110px',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                top: 0,
              }}
            >
              {isReady ? (
                <HDXHistogram
                  config={chartsConfig}
                  onTimeRangeSelect={onTimeRangeSelect}
                  isLive={isLive}
                  isUTC={isUTC}
                />
              ) : null}
            </div>
          </div>
        </div>
        {shouldShowLiveModeHint && resultsMode === 'search' && (
          <div className="d-flex justify-content-center" style={{ height: 0 }}>
            <div style={{ position: 'relative', top: -22, zIndex: 2 }}>
              <Button
                variant="outline-success"
                className="fs-8 bg-hdx-dark py-1"
                onClick={() => {
                  setIsLive(true);
                }}
              >
                <i className="bi text-success bi-lightning-charge-fill me-2" />
                Resume Live Tail
              </Button>
            </div>
          </div>
        )}
        <div className="px-3 flex-grow-1 bg-inherit" style={{ minHeight: 0 }}>
          {isReady ? (
            resultsMode === 'search' || isLive ? (
              <LogViewerContainer
                config={chartsConfig}
                onPropertyAddClick={onPropertyAddClick}
                generateSearchUrl={generateSearchUrl}
                generateChartUrl={generateChartUrl}
                onPropertySearchClick={onPropertySearchClick}
                isLive={isLive}
                setIsLive={setIsLive}
                isUTC={isUTC}
                setIsUTC={setIsUTC}
                onShowPatternsClick={() => {
                  setIsLive(false);
                  setResultsMode('patterns');
                }}
              />
            ) : (
              <MemoPatternTableWithSidePanel
                isUTC={isUTC}
                config={chartsConfig}
                onShowEventsClick={onShowEventsClick}
              />
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}

SearchPage.getLayout = withAppNav;

// TODO: Restore when we fix hydration errors
// export default SearchPage;

const SearchPageDynamic = dynamic(async () => SearchPage, { ssr: false });
// @ts-ignore
SearchPageDynamic.getLayout = withAppNav;

export default SearchPageDynamic;
