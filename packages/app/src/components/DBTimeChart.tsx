import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import cx from 'classnames';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import {
  ChartConfigWithDateRange,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';
import { Button, Code, Group, Modal, Stack, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconArrowsDiagonal, IconSearch } from '@tabler/icons-react';

import {
  buildChartViewEventsParams,
  formatResponseForTimeChart,
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
  buildQParams,
  onDismiss,
}: {
  activeClickPayload: ActiveClickPayload | undefined;
  buildQParams: (key?: string, value?: number) => URLSearchParams | null;
  onDismiss: () => void;
}) {
  if (
    activeClickPayload == null ||
    !activeClickPayload.activePayload ||
    activeClickPayload.activePayload.length === 0
  ) {
    return null;
  }

  // Filter out null/zero values early so length check is accurate
  const validPayloads = activeClickPayload.activePayload
    .filter(p => p.value != null && p.value !== 0)
    .sort((a, b) => b.value! - a.value!); // Sort by value descending (highest first)

  return (
    <>
      {/* Backdrop to dismiss menu */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 4,
        }}
        onClick={onDismiss}
      />
      <div
        className="bg-muted px-3 py-2 rounded fs-8 shadow"
        style={{
          zIndex: 5,
          position: 'absolute',
          top: 0,
          left: 0,
          visibility: 'visible',
          maxHeight: '190px',
          overflowY: 'auto',
          transform: `translate(${
            activeClickPayload.xPerc > 0.5
              ? (activeClickPayload?.x ?? 0) - 130
              : (activeClickPayload?.x ?? 0) + 4
          }px, ${activeClickPayload?.y ?? 0}px)`,
        }}
      >
        {validPayloads.length <= 1 ? (
          // Fallback scenario if limited data is available
          <Link
            data-testid="chart-view-events-link"
            href={`/search?${buildQParams(
              validPayloads?.[0]?.dataKey,
              validPayloads?.[0]?.value,
            )?.toString()}`}
            onClick={onDismiss}
          >
            <Group gap="xs">
              <IconSearch size={16} />
              View Events
            </Group>
          </Link>
        ) : (
          <Stack>
            <Text c="gray.5" size="xs">
              View Events for:
            </Text>
            {validPayloads.map((payload, idx) => {
              const seriesQParams = buildQParams(
                payload.dataKey,
                payload.value,
              )?.toString();
              return (
                <Link
                  key={idx}
                  data-testid={`chart-view-events-link-${payload.dataKey}`}
                  href={`/search${seriesQParams ? `?${seriesQParams}` : ''}`}
                  onClick={onDismiss}
                >
                  <Group gap="xs">
                    <IconSearch size={12} />
                    {payload.name}
                  </Group>
                </Link>
              );
            })}
          </Stack>
        )}
      </div>
    </>
  );
}

function DBTimeChartComponent({
  config,
  enabled = true,
  logReferenceTimestamp,
  onSettled,
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

  const queriedConfig = {
    ...config,
    granularity,
    limit: { limit: 100000 },
  };

  const { data, isLoading, isError, error, isPlaceholderData, isSuccess } =
    useQueriedChartConfig(queriedConfig, {
      placeholderData: (prev: any) => prev,
      queryKey: [queryKeyPrefix, queriedConfig, 'chunked'],
      enabled,
      enableQueryChunking: true,
    });

  useEffect(() => {
    if (!isError && isErrorExpanded) {
      errorExpansion.close();
    }
  }, [isError, isErrorExpanded, errorExpansion]);

  const isLoadingOrPlaceholder =
    isLoading || !data?.isComplete || isPlaceholderData;
  const { data: source } = useSource({ id: sourceId });

  const {
    graphResults,
    timestampColumn,
    groupKeys,
    lineNames,
    lineColors,
    groupColumns,
    valueColumns,
    isSingleValueColumn,
  } = useMemo(() => {
    const defaultResponse = {
      graphResults: [],
      timestampColumn: undefined,
      groupKeys: [],
      lineNames: [],
      lineColors: [],
      groupColumns: [],
      valueColumns: [],
      isSingleValueColumn: true,
    };

    if (data == null || !isSuccess) {
      return defaultResponse;
    }

    try {
      return formatResponseForTimeChart({
        res: data,
        dateRange,
        granularity,
        generateEmptyBuckets: fillNulls !== false,
        source,
      });
    } catch (e) {
      console.error(e);
      return defaultResponse;
    }
  }, [data, dateRange, granularity, isSuccess, fillNulls, source]);

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

  const [activeClickPayload, setActiveClickPayload] = useState<
    ActiveClickPayload | undefined
  >(undefined);

  // Wrap the setter to only allow setting if source is available
  const setActiveClickPayloadIfSourceAvailable = useCallback(
    (payload: ActiveClickPayload | undefined) => {
      if (source == null) {
        return; // Don't set if no source
      }
      setActiveClickPayload(payload);
    },
    [source],
  );

  const clickedActiveLabelDate = useMemo(() => {
    return activeClickPayload?.activeLabel != null
      ? new Date(Number.parseInt(activeClickPayload.activeLabel) * 1000)
      : undefined;
  }, [activeClickPayload]);

  const buildQParams = useCallback(
    (seriesKey?: string, seriesValue?: number) => {
      if (clickedActiveLabelDate == null || source == null) {
        return null;
      }

      return buildChartViewEventsParams({
        clickedDate: clickedActiveLabelDate,
        config,
        granularity,
        source,
        groupColumns: groupColumns ?? [],
        valueColumns: valueColumns ?? [],
        isSingleValueColumn: isSingleValueColumn ?? true,
        seriesKey,
        seriesValue,
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
          buildQParams={buildQParams}
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
                    <i className="bi bi-exclamation-triangle"></i> Only top{' '}
                    {groupKeys.length} groups shown
                  </span>
                </div>
                ) : null*/}
        {showDisplaySwitcher && (
          <div
            className="bg-muted px-3 py-2 rounded fs-8"
            style={{
              zIndex: 5,
              position: 'absolute',
              top: 0,
              right: 0,
              visibility: 'visible',
            }}
          >
            <span
              className={cx('text-decoration-none fs-7 cursor-pointer me-2', {
                'text-success': displayType === 'line',
                'text-muted-hover': displayType !== 'line',
              })}
              role="button"
              title="Display as line chart"
              onClick={() => handleSetDisplayType(DisplayType.Line)}
            >
              <i className="bi bi-graph-up"></i>
            </span>
            <span
              className={cx('text-decoration-none fs-7 cursor-pointer', {
                'text-success': displayType === 'stacked_bar',
                'text-muted-hover': displayType !== 'stacked_bar',
              })}
              role="button"
              title="Display as bar chart"
              onClick={() => handleSetDisplayType(DisplayType.StackedBar)}
            >
              <i className="bi bi-bar-chart"></i>
            </span>
          </div>
        )}
        <MemoChart
          dateRange={dateRange}
          displayType={displayType}
          graphResults={graphResults}
          groupKeys={groupKeys}
          isClickActive={activeClickPayload}
          isLoading={isLoadingOrPlaceholder}
          lineColors={lineColors}
          lineNames={lineNames}
          logReferenceTimestamp={logReferenceTimestamp}
          numberFormat={config.numberFormat}
          onTimeRangeSelect={onTimeRangeSelect}
          referenceLines={referenceLines}
          setIsClickActive={setActiveClickPayloadIfSourceAvailable}
          showLegend={showLegend}
          timestampKey={timestampColumn?.name}
        />
      </div>
    </div>
  );
}

export const DBTimeChart = memo(DBTimeChartComponent);
