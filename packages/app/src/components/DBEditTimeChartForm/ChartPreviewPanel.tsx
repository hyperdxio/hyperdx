import { useCallback, useMemo, useState } from 'react';
import { Trans } from 'next-i18next/pages';
import { convertDateRangeToGranularityString } from '@hyperdx/common-utils/dist/core/utils';
import { isBuilderChartConfig } from '@hyperdx/common-utils/dist/guards';
import {
  BuilderChartConfigWithDateRange,
  BuilderChartConfigWithOptTimestamp,
  ChartConfigWithDateRange,
  ChartConfigWithOptTimestamp,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Accordion, Divider, Stack, Text } from '@mantine/core';
import { IconCode, IconList } from '@tabler/icons-react';
import { SortingState } from '@tanstack/react-table';

import { buildTableRowSearchUrl } from '@/ChartUtils';
import { getAlertReferenceLines } from '@/components/Alerts';
import { ChartEditorFormState } from '@/components/ChartEditor/types';
import ChartSQLPreview from '@/components/ChartSQLPreview';
import DBHeatmapChart, {
  buildHeatmapBoundsConfig,
  buildHeatmapBucketConfig,
  HEATMAP_N_BUCKETS,
  toHeatmapChartConfig,
} from '@/components/DBHeatmapChart';
import DBNumberChart from '@/components/DBNumberChart';
import { DBPieChart } from '@/components/DBPieChart';
import DBSqlRowTableWithSideBar from '@/components/DBSqlRowTableWithSidebar';
import DBTableChart from '@/components/DBTableChart';
import { DBTimeChart } from '@/components/DBTimeChart';
import EmptyState from '@/components/EmptyState';
import { getFirstTimestampValueExpression } from '@/source';
import {
  orderByStringToSortingState,
  sortingStateToOrderByString,
} from '@/utils';

import { buildSampleEventsConfig, isQueryReady } from './utils';

function HeatmapPreview({
  config,
}: {
  config: BuilderChartConfigWithDateRange;
}) {
  const { heatmapConfig, scaleType } = toHeatmapChartConfig(config);
  return (
    <div className="flex-grow-1 d-flex flex-column" style={{ height: 400 }}>
      <DBHeatmapChart config={heatmapConfig} scaleType={scaleType} showLegend />
    </div>
  );
}

/**
 * Heatmap renders via two sequential ClickHouse queries — bounds first, then
 * the bucketed-counts query that uses the resolved min/max.  Show both,
 * labeled, with placeholder tokens for the bucket-array literals (which only
 * exist at runtime once the bounds query returns).
 */
function HeatmapSQLPreview({
  config,
  dateRange,
}: {
  config: BuilderChartConfigWithOptTimestamp;
  dateRange: [Date, Date];
}) {
  if (!config.timestampValueExpression) {
    return null;
  }
  const { heatmapConfig, scaleType } = toHeatmapChartConfig(
    config as BuilderChartConfigWithDateRange,
  );
  const granularity = convertDateRangeToGranularityString(dateRange, 245);

  const boundsConfig = buildHeatmapBoundsConfig({
    config: heatmapConfig,
    scaleType,
  });

  const bucketConfig = buildHeatmapBucketConfig({
    config: heatmapConfig,
    scaleType,
    effectiveMin: '{min}',
    max: '{max}',
    granularity,
    nBuckets: HEATMAP_N_BUCKETS,
  });

  return (
    <Stack gap="md">
      <div>
        <Text size="xs" c="dimmed" mb={4}>
          <Trans>
            1. Bounds query — resolves min/max for bucket boundaries
          </Trans>
        </Text>
        <ChartSQLPreview config={boundsConfig} enableCopy />
      </div>
      <div>
        <Text size="xs" c="dimmed" mb={4}>
          <Trans>2. Heatmap query — runs after bounds resolve;</Trans>{' '}
          <code>{'{min}'}</code>/<code>{'{max}'}</code>{' '}
          <Trans>are filled in at runtime</Trans>
        </Text>
        <ChartSQLPreview config={bucketConfig} enableCopy />
      </div>
    </Stack>
  );
}

type ChartPreviewPanelProps = {
  queriedConfig?: ChartConfigWithDateRange;
  tableSource?: TSource;
  dateRange: [Date, Date];
  activeTab: string;
  alert?: ChartEditorFormState['alert'];
  sourceId?: string;
  onTimeRangeSelect?: (start: Date, end: Date) => void;
  chartConfigForExplanations?: ChartConfigWithOptTimestamp;
  showGeneratedSql: boolean;
  showSampleEvents: boolean;
  dbTimeChartConfig?: ChartConfigWithDateRange;
  setValue: (name: 'orderBy', value: string) => void;
  onSubmit: () => void;
};

export function ChartPreviewPanel({
  queriedConfig,
  tableSource,
  dateRange,
  activeTab,
  alert,
  sourceId,
  onTimeRangeSelect,
  chartConfigForExplanations,
  showGeneratedSql,
  showSampleEvents,
  dbTimeChartConfig,
  setValue,
  onSubmit,
}: ChartPreviewPanelProps) {
  const [isSampleEventsOpen, setIsSampleEventsOpen] = useState(false);

  const queryReady = !!isQueryReady(queriedConfig);

  const onTableSortingChange = useCallback(
    (sortState: SortingState | null) => {
      setValue('orderBy', sortingStateToOrderByString(sortState) ?? '');
      onSubmit();
    },
    [setValue, onSubmit],
  );

  const tableSortState = useMemo(
    () =>
      queriedConfig != null &&
      isBuilderChartConfig(queriedConfig) &&
      queriedConfig.orderBy &&
      typeof queriedConfig.orderBy === 'string'
        ? orderByStringToSortingState(queriedConfig.orderBy)
        : undefined,
    [queriedConfig],
  );

  const sampleEventsConfig = useMemo(
    () =>
      buildSampleEventsConfig(
        queriedConfig,
        tableSource,
        dateRange,
        queryReady,
      ),
    [queriedConfig, tableSource, dateRange, queryReady],
  );

  return (
    <>
      {!queryReady && activeTab !== 'markdown' ? (
        <EmptyState
          description="Please start by defining your chart above and then click the play button to query data."
          variant="card"
          fullWidth
        />
      ) : undefined}
      {queryReady && queriedConfig != null && activeTab === 'table' && (
        <div className="flex-grow-1 d-flex flex-column" style={{ height: 400 }}>
          <DBTableChart
            config={queriedConfig}
            getRowSearchLink={
              isBuilderChartConfig(queriedConfig)
                ? row =>
                    buildTableRowSearchUrl({
                      row,
                      source: tableSource,
                      config: queriedConfig,
                      dateRange: queriedConfig.dateRange,
                    })
                : undefined
            }
            onSortingChange={onTableSortingChange}
            sort={tableSortState}
            showMVOptimizationIndicator={false}
          />
        </div>
      )}
      {queryReady && dbTimeChartConfig != null && activeTab === 'time' && (
        <div className="flex-grow-1 d-flex flex-column" style={{ height: 400 }}>
          <DBTimeChart
            sourceId={sourceId}
            config={dbTimeChartConfig}
            onTimeRangeSelect={onTimeRangeSelect}
            referenceLines={
              alert &&
              getAlertReferenceLines({
                threshold: alert.threshold,
                thresholdMax: alert.thresholdMax,
                thresholdType: alert.thresholdType,
              })
            }
            errorVariant="inline"
            showMVOptimizationIndicator={false}
          />
        </div>
      )}
      {queryReady && queriedConfig != null && activeTab === 'pie' && (
        <div className="flex-grow-1 d-flex flex-column" style={{ height: 400 }}>
          <DBPieChart
            config={queriedConfig}
            showMVOptimizationIndicator={false}
            errorVariant="inline"
          />
        </div>
      )}
      {queryReady && queriedConfig != null && activeTab === 'number' && (
        <div className="flex-grow-1 d-flex flex-column" style={{ height: 400 }}>
          <DBNumberChart
            config={queriedConfig}
            showMVOptimizationIndicator={false}
            errorVariant="inline"
          />
        </div>
      )}
      {queryReady &&
        queriedConfig != null &&
        isBuilderChartConfig(queriedConfig) &&
        activeTab === 'heatmap' && <HeatmapPreview config={queriedConfig} />}
      {queryReady &&
        tableSource &&
        queriedConfig != null &&
        isBuilderChartConfig(queriedConfig) &&
        activeTab === 'search' && (
          <div
            className="flex-grow-1 d-flex flex-column"
            style={{ height: 400 }}
          >
            <DBSqlRowTableWithSideBar
              sourceId={tableSource.id}
              config={{
                ...queriedConfig,
                orderBy: [
                  {
                    ordering: 'DESC' as const,
                    valueExpression: getFirstTimestampValueExpression(
                      tableSource.timestampValueExpression,
                    ),
                  },
                ],
                dateRange,
                timestampValueExpression: tableSource.timestampValueExpression,
                connection: tableSource.connection,
                from: tableSource.from,
                limit: { limit: 200 },
                // Search mode requires a string select, not an array of aggregations
                select:
                  typeof queriedConfig.select === 'string' &&
                  queriedConfig.select
                    ? queriedConfig.select
                    : ((tableSource?.kind === SourceKind.Log ||
                        tableSource?.kind === SourceKind.Trace) &&
                        tableSource.defaultTableSelectExpression) ||
                      '',
                groupBy: undefined,
                having: undefined,
                granularity: undefined,
              }}
              enabled
              isLive={false}
              queryKeyPrefix={'search'}
            />
          </div>
        )}
      {showGeneratedSql && (
        <>
          <Divider mt="md" />
          {showSampleEvents && (
            <Accordion
              value={isSampleEventsOpen ? 'sample' : null}
              onChange={value => setIsSampleEventsOpen(value === 'sample')}
            >
              <Accordion.Item value="sample">
                <Accordion.Control icon={<IconList size={16} />}>
                  <Text size="sm" style={{ alignSelf: 'center' }}>
                    <Trans>Sample Matched Events</Trans>
                  </Text>
                </Accordion.Control>
                <Accordion.Panel>
                  {sampleEventsConfig != null && tableSource && (
                    <div
                      className="flex-grow-1 d-flex flex-column"
                      style={{ height: 400 }}
                    >
                      <DBSqlRowTableWithSideBar
                        sourceId={tableSource.id}
                        config={sampleEventsConfig}
                        enabled={isSampleEventsOpen}
                        isLive={false}
                        queryKeyPrefix={'search'}
                      />
                    </div>
                  )}
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          )}
          <Accordion defaultValue="">
            <Accordion.Item value={'SQL'}>
              <Accordion.Control icon={<IconCode size={16} />}>
                <Text size="sm" style={{ alignSelf: 'center' }}>
                  <Trans>Generated SQL</Trans>
                </Text>
              </Accordion.Control>
              <Accordion.Panel>
                {queryReady &&
                  chartConfigForExplanations != null &&
                  (activeTab === 'heatmap' &&
                  isBuilderChartConfig(chartConfigForExplanations) ? (
                    <HeatmapSQLPreview
                      config={chartConfigForExplanations}
                      dateRange={dateRange}
                    />
                  ) : (
                    <ChartSQLPreview
                      config={chartConfigForExplanations}
                      enableCopy
                    />
                  ))}
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </>
      )}
    </>
  );
}
