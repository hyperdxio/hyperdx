import { memo, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import cx from 'classnames';
import { add } from 'date-fns';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import { isMetricChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
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
  Text,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconArrowsDiagonal } from '@tabler/icons-react';

import {
  formatResponseForTimeChart,
  getPreviousDateRange,
  getPreviousPeriodOffset,
  useTimeChartSettings,
} from '@/ChartUtils';
import { convertGranularityToSeconds } from '@/ChartUtils';
import { MemoChart } from '@/HDXMultiSeriesTimeChart';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useSource } from '@/source';

import { SQLPreview } from './ChartSQLPreview';

// TODO: Support clicking in to view matched events

function DBTimeChartComponent({
  config,
  enabled = true,
  logReferenceTimestamp,
  onTimeRangeSelect,
  queryKeyPrefix,
  referenceLines,
  setDisplayType,
  showDisplaySwitcher = true,
  showLegend = true,
  sourceId,
}: {
  config: ChartConfigWithDateRange;
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
}) {
  const [isErrorExpanded, errorExpansion] = useDisclosure(false);
  const {
    displayType: displayTypeProp,
    dateRange,
    granularity,
    fillNulls,
  } = useTimeChartSettings(config);

  const queriedConfig = useMemo(
    () => ({
      ...config,
      granularity,
      limit: { limit: 100000 },
    }),
    [config, granularity],
  );

  const { data, isLoading, isError, error, isPlaceholderData, isSuccess } =
    useQueriedChartConfig(queriedConfig, {
      placeholderData: (prev: any) => prev,
      queryKey: [queryKeyPrefix, queriedConfig, 'chunked'],
      enabled,
      enableQueryChunking: true,
    });

  const previousPeriodChartConfig: ChartConfigWithDateRange = useMemo(() => {
    return {
      ...queriedConfig,
      dateRange: getPreviousDateRange(dateRange),
    };
  }, [queriedConfig, dateRange]);

  const previousPeriodOffset = useMemo(() => {
    return config.compareToPreviousPeriod
      ? getPreviousPeriodOffset(dateRange)
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

  const { graphResults, timestampColumn, lineData } = useMemo(() => {
    const defaultResponse = {
      graphResults: [],
      timestampColumn: undefined,
      lineData: [],
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
    | {
        x: number;
        y: number;
        activeLabel: string;
        xPerc: number;
        yPerc: number;
      }
    | undefined
  >(undefined);

  const clickedActiveLabelDate = useMemo(() => {
    return activeClickPayload?.activeLabel != null
      ? new Date(Number.parseInt(activeClickPayload.activeLabel) * 1000)
      : undefined;
  }, [activeClickPayload]);

  const qparams = useMemo(() => {
    if (clickedActiveLabelDate == null || !source?.id == null) {
      return null;
    }
    const isMetricChart = isMetricChartConfig(config);
    if (isMetricChart && source?.logSourceId == null) {
      notifications.show({
        color: 'yellow',
        message: 'No log source is associated with the selected metric source.',
      });
      return null;
    }
    const from = clickedActiveLabelDate.getTime();
    const to = add(clickedActiveLabelDate, {
      seconds: convertGranularityToSeconds(granularity),
    }).getTime();
    let where = config.where;
    let whereLanguage = config.whereLanguage || 'lucene';
    if (
      where.length === 0 &&
      Array.isArray(config.select) &&
      config.select.length === 1
    ) {
      where = config.select[0].aggCondition ?? '';
      whereLanguage = config.select[0].aggConditionLanguage ?? 'lucene';
    }
    const params: Record<string, string> = {
      source: (isMetricChart ? source?.logSourceId : source?.id) ?? '',
      where: where,
      whereLanguage: whereLanguage,
      filters: JSON.stringify(config.filters ?? []),
      isLive: 'false',
      from: from.toString(),
      to: to.toString(),
    };
    // Include the select parameter if provided to preserve custom columns
    // eventTableSelect is used for charts that override select (like histograms with count)
    // to preserve the original table's select expression
    if (config.eventTableSelect) {
      params.select = config.eventTableSelect;
    }
    return new URLSearchParams(params);
  }, [clickedActiveLabelDate, config, granularity, source]);

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
        {activeClickPayload != null &&
        qparams != null &&
        // only View Events for single series
        (!Array.isArray(config.select) || config.select.length === 1) ? (
          <div
            className="bg-muted px-3 py-2 rounded fs-8"
            style={{
              zIndex: 5,
              position: 'absolute',
              top: 0,
              left: 0,
              visibility: 'visible',
              transform: `translate(${
                activeClickPayload.xPerc > 0.5
                  ? (activeClickPayload?.x ?? 0) - 130
                  : (activeClickPayload?.x ?? 0) + 4
              }px, ${activeClickPayload?.y ?? 0}px)`,
            }}
          >
            <Link
              data-testid="chart-view-events-link"
              href={`/search?${qparams?.toString()}`}
              className="text-white-hover text-decoration-none"
              onClick={() => setActiveClickPayload(undefined)}
            >
              <i className="bi bi-search me-1"></i> View Events
            </Link>
          </div>
        ) : null}
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
                    <i className="bi bi-exclamation-triangle"></i> Only top{' '}
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
            <Tooltip label="Display as line chart">
              <ActionIcon
                size="xs"
                me={2}
                className={cx({
                  'text-success': displayType === 'line',
                  'text-muted-hover': displayType !== 'line',
                })}
                onClick={() => handleSetDisplayType(DisplayType.Line)}
              >
                <i className="bi bi-graph-up"></i>
              </ActionIcon>
            </Tooltip>

            <Tooltip
              label={
                config.compareToPreviousPeriod
                  ? 'Bar chart is disabled when comparing to previous period'
                  : 'Display as bar chart'
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
                <i className="bi bi-bar-chart"></i>
              </ActionIcon>
            </Tooltip>
          </div>
        )}
        <MemoChart
          dateRange={dateRange}
          displayType={displayType}
          graphResults={graphResults}
          lineData={lineData}
          isClickActive={false}
          isLoading={isLoadingOrPlaceholder}
          logReferenceTimestamp={logReferenceTimestamp}
          numberFormat={config.numberFormat}
          onTimeRangeSelect={onTimeRangeSelect}
          referenceLines={referenceLines}
          setIsClickActive={setActiveClickPayload}
          showLegend={showLegend}
          timestampKey={timestampColumn?.name}
          previousPeriodOffset={previousPeriodOffset}
        />
      </div>
    </div>
  );
}

export const DBTimeChart = memo(DBTimeChartComponent);
