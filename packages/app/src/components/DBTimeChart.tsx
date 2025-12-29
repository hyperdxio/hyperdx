import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import cx from 'classnames';
import { add } from 'date-fns';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import {
  ChartConfigWithDateRange,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Button,
  Code,
  Group,
  Modal,
  Popover,
  Portal,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconArrowsDiagonal,
  IconChartBar,
  IconChartLine,
  IconSearch,
} from '@tabler/icons-react';

import api from '@/api';
import {
  AGG_FNS,
  buildEventsSearchUrl,
  ChartKeyJoiner,
  convertGranularityToSeconds,
  convertToTimeChartConfig,
  formatResponseForTimeChart,
  getPreviousDateRange,
  getPreviousPeriodOffsetSeconds,
  PreviousPeriodSuffix,
  useTimeChartSettings,
} from '@/ChartUtils';
import { MemoChart } from '@/HDXMultiSeriesTimeChart';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useSource } from '@/source';

import { SQLPreview } from './ChartSQLPreview';

type ActiveClickPayload = {
  x: number;
  y: number;
  activeLabel: string;
  xPerc: number;
  yPerc: number;
  activePayload?: { value?: number; dataKey?: string; name?: string }[];
};

function ActiveTimeTooltip({
  activeClickPayload,
  buildSearchUrl,
  onDismiss,
}: {
  activeClickPayload: ActiveClickPayload | undefined;
  buildSearchUrl: (key?: string, value?: number) => string | null;
  onDismiss: () => void;
}) {
  const isOpen =
    activeClickPayload != null &&
    activeClickPayload.activePayload != null &&
    activeClickPayload.activePayload.length > 0;

  if (!isOpen) {
    return null;
  }

  const validPayloads = activeClickPayload
    .activePayload!.filter(
      p =>
        p.value != null &&
        // Exclude previous period series
        // TODO: it would be cool to support this in the future
        !p.dataKey?.endsWith(PreviousPeriodSuffix),
    )
    .sort((a, b) => b.value! - a.value!); // Sort by value descending (highest first)

  return (
    <>
      {/* Backdrop to capture clicks and prevent propagation to chart */}
      <Portal>
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 199, // Just below Mantine Popover default (200)
          }}
          onClick={e => {
            e.stopPropagation();
            e.preventDefault();
            onDismiss();
          }}
          onMouseDown={e => {
            e.stopPropagation();
          }}
        />
      </Portal>

      <Popover
        opened={isOpen}
        onChange={opened => {
          if (!opened) {
            onDismiss();
          }
        }}
        position="bottom-start"
        offset={4}
        withinPortal
        closeOnEscape
        withArrow
        shadow="md"
      >
        <Popover.Target>
          <div
            style={{
              position: 'absolute',
              left: activeClickPayload.x ?? 0,
              top: activeClickPayload.y ?? 0,
              width: 1,
              height: 1,
              pointerEvents: 'none',
            }}
          />
        </Popover.Target>
        <Popover.Dropdown
          p="xs"
          maw={300}
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
        >
          {validPayloads.length <= 1 ? (
            // Fallback scenario if limited data is available
            <Link
              data-testid="chart-view-events-link"
              href={
                buildSearchUrl(
                  validPayloads?.[0]?.dataKey,
                  validPayloads?.[0]?.value,
                ) ?? '/search'
              }
              onClick={onDismiss}
            >
              <Group gap="xs">
                <IconSearch size={16} />
                View Events
              </Group>
            </Link>
          ) : (
            <Stack gap="xs" style={{ maxHeight: '170px', overflowY: 'auto' }}>
              <Text c="gray.5" size="xs">
                View Events for:
              </Text>
              {validPayloads.map((payload, idx) => {
                const seriesUrl = buildSearchUrl(
                  payload.dataKey,
                  payload.value,
                );
                return (
                  <Tooltip
                    key={idx}
                    label={payload.name}
                    withArrow
                    color="gray"
                    position="right"
                  >
                    <Link
                      data-testid={`chart-view-events-link-${payload.dataKey}`}
                      href={seriesUrl ?? '/search'}
                      onClick={onDismiss}
                    >
                      <Group gap="xs">
                        <IconSearch size={12} />
                        <Text size="xs" truncate flex="1">
                          {payload.name}
                        </Text>
                      </Group>
                    </Link>
                  </Tooltip>
                );
              })}
            </Stack>
          )}
        </Popover.Dropdown>
      </Popover>
    </>
  );
}

type DBTimeChartComponentProps = {
  config: ChartConfigWithDateRange;
  disableQueryChunking?: boolean;
  disableDrillDown?: boolean;
  enableParallelQueries?: boolean;
  enabled?: boolean;
  logReferenceTimestamp?: number;
  onSettled?: () => void;
  onTimeRangeSelect?: (start: Date, end: Date) => void;
  queryKeyPrefix?: string;
  referenceLines?: React.ReactNode;
  setDisplayType?: (type: DisplayType) => void;
  showDisplaySwitcher?: boolean;
  showLegend?: boolean;
  sourceId?: string;
  /** Names of series that should not be shown in the chart */
  hiddenSeries?: string[];
};

function DBTimeChartComponent({
  config,
  disableQueryChunking,
  disableDrillDown,
  enableParallelQueries,
  enabled = true,
  logReferenceTimestamp,
  onTimeRangeSelect,
  queryKeyPrefix,
  referenceLines,
  setDisplayType,
  showDisplaySwitcher = true,
  showLegend = true,
  sourceId,
  hiddenSeries,
}: DBTimeChartComponentProps) {
  const [isErrorExpanded, errorExpansion] = useDisclosure(false);
  const {
    displayType: displayTypeProp,
    dateRange,
    granularity,
    fillNulls,
  } = useTimeChartSettings(config);

  const queriedConfig = useMemo(
    () => convertToTimeChartConfig(config),
    [config],
  );

  const { data: me, isLoading: isLoadingMe } = api.useMe();
  const { data, isLoading, isError, error, isPlaceholderData, isSuccess } =
    useQueriedChartConfig(queriedConfig, {
      placeholderData: (prev: any) => prev,
      queryKey: [
        queryKeyPrefix,
        queriedConfig,
        'chunked',
        {
          disableQueryChunking,
          enableParallelQueries,
          parallelizeWhenPossible: me?.team?.parallelizeWhenPossible,
        },
      ],
      enabled: enabled && !isLoadingMe,
      enableQueryChunking: !disableQueryChunking,
      enableParallelQueries:
        enableParallelQueries && me?.team?.parallelizeWhenPossible,
    });

  const previousPeriodChartConfig: ChartConfigWithDateRange = useMemo(() => {
    return {
      ...queriedConfig,
      dateRange: getPreviousDateRange(dateRange),
    };
  }, [queriedConfig, dateRange]);

  const previousPeriodOffsetSeconds = useMemo(() => {
    return config.compareToPreviousPeriod
      ? getPreviousPeriodOffsetSeconds(dateRange)
      : undefined;
  }, [dateRange, config.compareToPreviousPeriod]);

  const { data: previousPeriodData, isLoading: isPreviousPeriodLoading } =
    useQueriedChartConfig(previousPeriodChartConfig, {
      placeholderData: (prev: any) => prev,
      queryKey: [queryKeyPrefix, previousPeriodChartConfig, 'chunked'],
      enabled: enabled && config.compareToPreviousPeriod,
      enableQueryChunking: true,
    });

  useEffect(() => {
    if (!isError && isErrorExpanded) {
      errorExpansion.close();
    }
  }, [isError, isErrorExpanded, errorExpansion]);

  const isLoadingOrPlaceholder =
    isLoading ||
    isPreviousPeriodLoading ||
    !data?.isComplete ||
    (config.compareToPreviousPeriod && !previousPeriodData?.isComplete) ||
    isPlaceholderData;
  const { data: source } = useSource({ id: sourceId });

  const {
    graphResults,
    timestampColumn,
    groupColumns,
    valueColumns,
    isSingleValueColumn,
    lineData,
  } = useMemo(() => {
    const defaultResponse = {
      graphResults: [],
      timestampColumn: undefined,
      lineData: [],
      groupColumns: [],
      valueColumns: [],
      isSingleValueColumn: true,
    };

    if (data == null || !isSuccess) {
      return defaultResponse;
    }

    try {
      return formatResponseForTimeChart({
        currentPeriodResponse: data,
        previousPeriodResponse: config.compareToPreviousPeriod
          ? previousPeriodData
          : undefined,
        dateRange,
        granularity,
        generateEmptyBuckets: fillNulls !== false,
        source,
        hiddenSeries,
      });
    } catch (e) {
      console.error(e);
      return defaultResponse;
    }
  }, [
    data,
    dateRange,
    granularity,
    isSuccess,
    fillNulls,
    source,
    config.compareToPreviousPeriod,
    previousPeriodData,
    hiddenSeries,
  ]);

  // To enable backward compatibility, allow non-controlled usage of displayType
  const [displayTypeLocal, setDisplayTypeLocal] = useState(displayTypeProp);

  const displayType = useMemo(() => {
    if (setDisplayType) {
      return displayTypeProp;
    } else {
      return displayTypeLocal;
    }
  }, [displayTypeLocal, displayTypeProp, setDisplayType]);

  const handleSetDisplayType = (type: DisplayType) => {
    if (setDisplayType) {
      setDisplayType(type);
    } else {
      setDisplayTypeLocal(type);
    }
  };

  useEffect(() => {
    if (config.compareToPreviousPeriod) {
      setDisplayTypeLocal(DisplayType.Line);
    }
  }, [config.compareToPreviousPeriod]);

  const [activeClickPayload, setActiveClickPayload] = useState<
    ActiveClickPayload | undefined
  >(undefined);

  // Wrap the setter to only allow setting if source is available
  const setActiveClickPayloadIfSourceAvailable = useCallback(
    (payload: ActiveClickPayload | undefined) => {
      if (source == null || disableDrillDown) {
        return; // Don't set if no source
      }
      setActiveClickPayload(payload);
    },
    [source, disableDrillDown],
  );

  const clickedActiveLabelDate = useMemo(() => {
    return activeClickPayload?.activeLabel != null
      ? new Date(Number.parseInt(activeClickPayload.activeLabel) * 1000)
      : undefined;
  }, [activeClickPayload]);

  const buildSearchUrl = useCallback(
    (seriesKey?: string, seriesValue?: number) => {
      if (clickedActiveLabelDate == null || source == null) {
        return null;
      }

      // Parse the series key to extract group values
      const seriesKeys = seriesKey?.split(ChartKeyJoiner);
      const groupFilters: Array<{ column: string; value: any }> = [];

      if (seriesKeys?.length && groupColumns?.length) {
        // Determine if the first part is a value column name
        const startsWithValueColumn =
          !(isSingleValueColumn ?? true) ||
          ((groupColumns?.length ?? 0) === 0 &&
            (valueColumns?.length ?? 0) > 0);
        const groupValues = startsWithValueColumn
          ? seriesKeys.slice(1)
          : seriesKeys;

        // Build group filters
        groupValues.forEach((value, index) => {
          if (groupColumns[index] != null) {
            groupFilters.push({
              column: groupColumns[index],
              value,
            });
          }
        });
      }

      // Build value range filter for Y-axis if provided
      let valueRangeFilter:
        | {
            expression: string;
            value: number;
          }
        | undefined;

      if (
        seriesValue &&
        Array.isArray(config.select) &&
        config.select.length > 0
      ) {
        // Determine which value column to filter on
        let valueExpression: string | undefined;

        if ((isSingleValueColumn ?? true) && config.select.length === 1) {
          const firstSelect = config.select[0];
          const aggFn =
            typeof firstSelect === 'string' ? undefined : firstSelect.aggFn;
          // Only add value range filter if the aggregation is attributable
          const isAttributable =
            AGG_FNS.find(fn => fn.value === aggFn)?.isAttributable !== false;

          if (isAttributable) {
            valueExpression =
              typeof firstSelect === 'string'
                ? firstSelect
                : firstSelect.valueExpression;
          }
        } else if (seriesKeys?.length && (valueColumns?.length ?? 0) > 0) {
          const firstPart = seriesKeys[0];
          const valueColumnIndex = valueColumns?.findIndex(
            col => col === firstPart,
          );

          if (
            valueColumnIndex != null &&
            valueColumnIndex >= 0 &&
            valueColumnIndex < config.select.length
          ) {
            const selectItem = config.select[valueColumnIndex];
            const aggFn =
              typeof selectItem === 'string' ? undefined : selectItem.aggFn;
            // Only add value range filter if the aggregation is attributable
            const isAttributable =
              AGG_FNS.find(fn => fn.value === aggFn)?.isAttributable !== false;

            if (isAttributable) {
              valueExpression =
                typeof selectItem === 'string'
                  ? selectItem
                  : selectItem.valueExpression;
            }
          }
        }

        if (valueExpression) {
          valueRangeFilter = {
            expression: valueExpression,
            value: seriesValue,
          };
        }
      }

      // Calculate time range from clicked date and granularity
      const from = clickedActiveLabelDate;
      const to = add(clickedActiveLabelDate, {
        seconds: convertGranularityToSeconds(granularity),
      });

      return buildEventsSearchUrl({
        source,
        config,
        dateRange: [from, to],
        groupFilters,
        valueRangeFilter,
      });
    },
    [
      clickedActiveLabelDate,
      config,
      granularity,
      source,
      groupColumns,
      valueColumns,
      isSingleValueColumn,
    ],
  );

  return isLoading && !data ? (
    <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
      Loading Chart Data...
    </div>
  ) : isError ? (
    <div className="h-100 w-100 d-flex g-1 flex-column align-items-center justify-content-center text-muted overflow-auto">
      <Text ta="center" size="sm" mt="sm">
        Error loading chart, please check your query or try again later.
      </Text>
      <Button
        className="mx-auto"
        variant="subtle"
        color="red"
        onClick={() => errorExpansion.open()}
      >
        <Group gap="xxs">
          <IconArrowsDiagonal size={16} />
          See Error Details
        </Group>
      </Button>
      <Modal
        opened={isErrorExpanded}
        onClose={() => errorExpansion.close()}
        title="Error Details"
      >
        <Group align="start">
          <Text size="sm" ta="center">
            Error Message:
          </Text>
          <Code
            block
            style={{
              whiteSpace: 'pre-wrap',
            }}
          >
            {error.message}
          </Code>
          {error instanceof ClickHouseQueryError && (
            <>
              <Text my="sm" size="sm" ta="center">
                Sent Query:
              </Text>
              <SQLPreview data={error?.query} />
            </>
          )}
        </Group>
      </Modal>
    </div>
  ) : graphResults.length === 0 ? (
    <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
      No data found within time range.
    </div>
  ) : (
    <div
      // Hack, recharts will release real fix soon https://github.com/recharts/recharts/issues/172
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        flexGrow: 1,
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
        <ActiveTimeTooltip
          activeClickPayload={activeClickPayload}
          buildSearchUrl={buildSearchUrl}
          onDismiss={() => setActiveClickPayload(undefined)}
        />
        {/* {totalGroups > groupKeys.length ? (
                <div
                  className="bg-muted px-3 py-2 rounded fs-8"
                  style={{
                    zIndex: 5,
                    position: 'absolute',
                    top: 0,
                    left: 50,
                    visibility: 'visible',
                  }}
                  title={`Only the top ${groupKeys.length} groups are shown, ${
                    totalGroups - groupKeys.length
                  } groups are hidden. Try grouping by a different field.`}
                >
                  <span className="text-muted-hover text-decoration-none fs-8">
                    <IconAlertTriangle size={14} style={{ display: 'inline' }} /> Only top{' '}
                    {groupKeys.length} groups shown
                  </span>
                </div>
                ) : null*/}
        {showDisplaySwitcher && (
          <div
            className="bg-muted px-2 py-1 rounded fs-8"
            style={{
              zIndex: 5,
              position: 'absolute',
              top: 0,
              right: 0,
              visibility: 'visible',
            }}
          >
            <Tooltip label="Display as Line Chart">
              <ActionIcon
                size="xs"
                me={2}
                className={cx({
                  'text-success': displayType === 'line',
                  'text-muted-hover': displayType !== 'line',
                })}
                onClick={() => handleSetDisplayType(DisplayType.Line)}
              >
                <IconChartLine />
              </ActionIcon>
            </Tooltip>

            <Tooltip
              label={
                config.compareToPreviousPeriod
                  ? 'Bar Chart Unavailable When Comparing to Previous Period'
                  : 'Display as Bar Chart'
              }
            >
              <ActionIcon
                size="xs"
                className={cx({
                  'text-success': displayType === 'stacked_bar',
                  'text-muted-hover': displayType !== 'stacked_bar',
                })}
                disabled={config.compareToPreviousPeriod}
                onClick={() => handleSetDisplayType(DisplayType.StackedBar)}
              >
                <IconChartBar />
              </ActionIcon>
            </Tooltip>
          </div>
        )}
        <MemoChart
          dateRange={dateRange}
          displayType={displayType}
          graphResults={graphResults}
          isClickActive={activeClickPayload}
          lineData={lineData}
          isLoading={isLoadingOrPlaceholder}
          logReferenceTimestamp={logReferenceTimestamp}
          numberFormat={config.numberFormat}
          onTimeRangeSelect={onTimeRangeSelect}
          referenceLines={referenceLines}
          setIsClickActive={setActiveClickPayloadIfSourceAvailable}
          showLegend={showLegend}
          timestampKey={timestampColumn?.name}
          previousPeriodOffsetSeconds={previousPeriodOffsetSeconds}
        />
      </div>
    </div>
  );
}

export const DBTimeChart = memo(DBTimeChartComponent);
