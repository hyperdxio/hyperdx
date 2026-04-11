import { useCallback, useMemo, useState } from 'react';
import { isBuilderChartConfig } from '@hyperdx/common-utils/dist/guards';
import {
  ChartConfigWithDateRange,
  ChartConfigWithOptTimestamp,
  DisplayType,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Accordion, Divider, Text } from '@mantine/core';
import { IconCode, IconList } from '@tabler/icons-react';
import { SortingState } from '@tanstack/react-table';

import { buildTableRowSearchUrl } from '@/ChartUtils';
import { getAlertReferenceLines } from '@/components/Alerts';
import { ChartEditorFormState } from '@/components/ChartEditor/types';
import ChartSQLPreview from '@/components/ChartSQLPreview';
import DBHeatmapChart from '@/components/DBHeatmapChart';
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
        activeTab === 'heatmap' && (
          <div
            className="flex-grow-1 d-flex flex-column"
            style={{ height: 400 }}
          >
            <DBHeatmapChart
              config={{
                ...queriedConfig,
                displayType: DisplayType.Heatmap,
                select: [
                  {
                    aggFn: 'heatmap' as const,
                    valueExpression:
                      (Array.isArray(queriedConfig.select)
                        ? queriedConfig.select[0]?.valueExpression
                        : undefined) ?? '',
                    countExpression: (Array.isArray(queriedConfig.select)
                      ? (queriedConfig.select[0] as Record<string, unknown>)
                          ?.countExpression
                      : undefined) as string | undefined,
                  },
                ],
                granularity: 'auto',
                numberFormat: queriedConfig.numberFormat,
              }}
            />
          </div>
        )}
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
                    Sample Matched Events
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
                  Generated SQL
                </Text>
              </Accordion.Control>
              <Accordion.Panel>
                {queryReady && chartConfigForExplanations != null && (
                  <ChartSQLPreview
                    config={chartConfigForExplanations}
                    enableCopy
                  />
                )}
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </>
      )}
    </>
  );
}
