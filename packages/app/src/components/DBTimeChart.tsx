import { useMemo, useState } from 'react';
import Link from 'next/link';
import cx from 'classnames';
import { add } from 'date-fns';
import {
  ClickHouseQueryError,
  formatResponseForTimeChart,
} from '@hyperdx/common-utils/dist/clickhouse';
import {
  ChartConfigWithDateRange,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';
import { Box, Button, Code, Collapse, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

import {
  convertDateRangeToGranularityString,
  Granularity,
  useTimeChartSettings,
} from '@/ChartUtils';
import { convertGranularityToSeconds } from '@/ChartUtils';
import { MemoChart } from '@/HDXMultiSeriesTimeChart';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';

import { SQLPreview } from './ChartSQLPreview';

// TODO: Support clicking in to view matched events

export function DBTimeChart({
  config,
  sourceId,
  onSettled,
  alertThreshold,
  alertThresholdType,
  showDisplaySwitcher = true,
  setDisplayType,
  logReferenceTimestamp,
  queryKeyPrefix,
  enabled = true,
  onTimeRangeSelect,
  showLegend = true,
}: {
  config: ChartConfigWithDateRange;
  sourceId?: string;
  onSettled?: () => void;
  alertThreshold?: number;
  alertThresholdType?: 'above' | 'below';
  showDisplaySwitcher?: boolean;
  setDisplayType?: (type: DisplayType) => void;
  logReferenceTimestamp?: number;
  queryKeyPrefix?: string;
  enabled?: boolean;
  onTimeRangeSelect?: (start: Date, end: Date) => void;
  showLegend?: boolean;
}) {
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
      queryKey: [queryKeyPrefix, queriedConfig],
      enabled,
    });

  const isLoadingOrPlaceholder = isLoading || isPlaceholderData;

  const { graphResults, timestampColumn, groupKeys, lineNames, lineColors } =
    useMemo(() => {
      return data != null && isSuccess
        ? formatResponseForTimeChart({
            res: data,
            dateRange,
            granularity,
            generateEmptyBuckets: fillNulls !== false,
          })
        : {
            graphResults: [],
            timestampColumn: undefined,
            groupKeys: [],
            lineNames: [],
            lineColors: [],
          };
    }, [data, dateRange, granularity, isSuccess, fillNulls]);

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
    if (!clickedActiveLabelDate || !sourceId) {
      return null;
    }
    const from = clickedActiveLabelDate.getTime();
    const to = add(clickedActiveLabelDate, {
      seconds: convertGranularityToSeconds(granularity),
    }).getTime();
    return new URLSearchParams({
      source: sourceId,
      where: config.where,
      whereLanguage: config.whereLanguage || 'lucene',
      filters: JSON.stringify(config.filters),
      from: from.toString(),
      to: to.toString(),
    });
  }, [clickedActiveLabelDate, config, granularity, sourceId]);

  return isLoading && !data ? (
    <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
      Loading Chart Data...
    </div>
  ) : isError ? (
    <div className="h-100 w-100 align-items-center justify-content-center text-muted overflow-auto">
      <Text ta="center" size="sm" mt="sm">
        Error loading chart, please check your query or try again later.
      </Text>
      <Box mt="sm">
        <Text my="sm" size="sm" ta="center">
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
      </Box>
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
        {activeClickPayload != null && qparams != null ? (
          <div
            className="bg-grey px-3 py-2 rounded fs-8"
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
                  className="bg-grey px-3 py-2 rounded fs-8"
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
            className="bg-grey px-3 py-2 rounded fs-8"
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
          isLoading={isLoadingOrPlaceholder}
          lineColors={lineColors}
          lineNames={lineNames}
          timestampKey={timestampColumn?.name}
          setIsClickActive={setActiveClickPayload}
          isClickActive={false}
          onTimeRangeSelect={onTimeRangeSelect}
          showLegend={showLegend}
          numberFormat={config.numberFormat}
        />
      </div>
    </div>
  );
}
