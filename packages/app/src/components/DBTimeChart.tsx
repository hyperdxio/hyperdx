import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { add, differenceInSeconds } from 'date-fns';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import { getAlignedDateRange } from '@hyperdx/common-utils/dist/core/utils';
import {
  ChartConfigWithDateRange,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';
import {
  Button,
  Code,
  Divider,
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
  PreviousPeriodSuffix,
  shouldFillNullsWithZero,
  useTimeChartSettings,
} from '@/ChartUtils';
import { MemoChart } from '@/HDXMultiSeriesTimeChart';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';
import { useSource } from '@/source';

import ChartContainer from './charts/ChartContainer';
import DateRangeIndicator from './charts/DateRangeIndicator';
import DisplaySwitcher from './charts/DisplaySwitcher';
import MVOptimizationIndicator from './MaterializedViews/MVOptimizationIndicator';
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
          <Stack gap="xs" style={{ maxHeight: '220px', overflowY: 'auto' }}>
            <Link
              data-testid="chart-view-events-link"
              href={buildSearchUrl() ?? '/search'}
              onClick={onDismiss}
            >
              <Group gap="xs">
                <IconSearch size={16} />
                View All Events
              </Group>
            </Link>
            {validPayloads.length > 1 && (
              <>
                <Divider />
                <Text c="gray.5" size="xs">
                  Filter by group:
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
              </>
            )}
          </Stack>
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
  title?: React.ReactNode;
  toolbarPrefix?: React.ReactNode[];
  toolbarSuffix?: React.ReactNode[];
  showMVOptimizationIndicator?: boolean;
  showDateRangeIndicator?: boolean;
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
  title,
  toolbarPrefix,
  toolbarSuffix,
  showMVOptimizationIndicator = true,
  showDateRangeIndicator = true,
}: DBTimeChartComponentProps) {
  const [isErrorExpanded, errorExpansion] = useDisclosure(false);
  const [selectedSeriesSet, setSelectedSeriesSet] = useState<Set<string>>(
    new Set(),
  );

  const handleToggleSeries = useCallback(
    (seriesName: string, isShiftKey?: boolean) => {
      setSelectedSeriesSet(prev => {
        const newSet = new Set(prev);

        if (isShiftKey) {
          // Shift-click: add to selection
          if (newSet.has(seriesName)) {
            newSet.delete(seriesName);
          } else {
            newSet.add(seriesName);
          }
        } else {
          // Regular click: toggle selection
          if (newSet.has(seriesName) && newSet.size === 1) {
            // If this is the only selected item, clear selection (show all)
            newSet.clear();
          } else {
            // Otherwise, select only this one
            newSet.clear();
            newSet.add(seriesName);
          }
        }

        return newSet;
      });
    },
    [],
  );

  const originalDateRange = config.dateRange;
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

  const { data: mvOptimizationData } =
    useMVOptimizationExplanation(queriedConfig);

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
    const previousPeriodDateRange =
      queriedConfig.alignDateRangeToGranularity === false
        ? getPreviousDateRange(originalDateRange)
        : getAlignedDateRange(
            getPreviousDateRange(originalDateRange),
            queriedConfig.granularity,
          );

    return {
      ...queriedConfig,
      dateRange: previousPeriodDateRange,
    };
  }, [queriedConfig, originalDateRange]);

  const previousPeriodOffsetSeconds = useMemo(() => {
    return config.compareToPreviousPeriod
      ? differenceInSeconds(
          dateRange[0],
          previousPeriodChartConfig.dateRange[0],
        )
      : undefined;
  }, [
    config.compareToPreviousPeriod,
    dateRange,
    previousPeriodChartConfig.dateRange,
  ]);

  const { data: previousPeriodData, isLoading: isPreviousPeriodLoading } =
    useQueriedChartConfig(previousPeriodChartConfig, {
      placeholderData: (prev: any) => prev,
      queryKey: [queryKeyPrefix, previousPeriodChartConfig, 'chunked'],
      enabled: !!(enabled && config.compareToPreviousPeriod),
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
  const { data: source } = useSource({ id: sourceId || config.source });

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
        generateEmptyBuckets: shouldFillNullsWithZero(fillNulls),
        source,
        hiddenSeries,
        previousPeriodOffsetSeconds,
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
    previousPeriodOffsetSeconds,
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

  const handleSetDisplayType = useCallback(
    (type: DisplayType) => {
      if (setDisplayType) {
        setDisplayType(type);
      } else {
        setDisplayTypeLocal(type);
      }
    },
    [setDisplayType],
  );

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

  const toolbarItemsMemo = useMemo(() => {
    const allToolbarItems = [];

    if (toolbarPrefix && toolbarPrefix.length > 0) {
      allToolbarItems.push(...toolbarPrefix);
    }

    if (source && showMVOptimizationIndicator) {
      allToolbarItems.push(
        <MVOptimizationIndicator
          key="db-time-chart-mv-indicator"
          config={queriedConfig}
          source={source}
          variant="icon"
        />,
      );
    }

    const mvDateRange = mvOptimizationData?.optimizedConfig?.dateRange;
    const isAlignedToChartGranularity =
      queriedConfig.alignDateRangeToGranularity !== false;

    if (
      showDateRangeIndicator &&
      (mvDateRange || isAlignedToChartGranularity)
    ) {
      const mvGranularity = isAlignedToChartGranularity
        ? undefined
        : mvOptimizationData?.explanations.find(e => e.success)?.mvConfig
            .minGranularity;

      allToolbarItems.push(
        <DateRangeIndicator
          key="db-time-chart-date-range-indicator"
          originalDateRange={config.dateRange}
          effectiveDateRange={mvDateRange || queriedConfig.dateRange}
          mvGranularity={mvGranularity}
        />,
      );
    }

    if (showDisplaySwitcher) {
      allToolbarItems.push(
        <DisplaySwitcher
          key="db-time-chart-display-switcher"
          value={displayType}
          onChange={handleSetDisplayType}
          options={[
            {
              value: DisplayType.Line,
              label: 'Display as Line Chart',
              icon: <IconChartLine />,
            },
            {
              value: DisplayType.StackedBar,
              label: config.compareToPreviousPeriod
                ? 'Bar Chart Unavailable When Comparing to Previous Period'
                : 'Display as Bar Chart',
              icon: <IconChartBar />,
              disabled: config.compareToPreviousPeriod,
            },
          ]}
        />,
      );
    }

    if (toolbarSuffix && toolbarSuffix.length > 0) {
      allToolbarItems.push(...toolbarSuffix);
    }

    return allToolbarItems;
  }, [
    config,
    displayType,
    handleSetDisplayType,
    showDisplaySwitcher,
    source,
    toolbarPrefix,
    toolbarSuffix,
    showMVOptimizationIndicator,
    showDateRangeIndicator,
    mvOptimizationData,
    queriedConfig,
  ]);

  return (
    <ChartContainer title={title} toolbarItems={toolbarItemsMemo}>
      {isLoading && !data ? (
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
            variant="danger"
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
        <>
          <ActiveTimeTooltip
            activeClickPayload={activeClickPayload}
            buildSearchUrl={buildSearchUrl}
            onDismiss={() => setActiveClickPayload(undefined)}
          />
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
            selectedSeriesNames={selectedSeriesSet}
            onToggleSeries={handleToggleSeries}
            granularity={granularity}
            dateRangeEndInclusive={queriedConfig.dateRangeEndInclusive}
          />
        </>
      )}
    </ChartContainer>
  );
}

export const DBTimeChart = memo(DBTimeChartComponent);
