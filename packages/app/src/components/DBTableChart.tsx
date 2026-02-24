import { useCallback, useMemo, useState } from 'react';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import { ChartConfigWithOptTimestamp } from '@hyperdx/common-utils/dist/types';
import { Box, Code, Text } from '@mantine/core';
import { SortingState } from '@tanstack/react-table';

import {
  buildMVDateRangeIndicator,
  convertToTableChartConfig,
} from '@/ChartUtils';
import { Table, TableVariant } from '@/HDXMultiSeriesTableChart';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';
import useOffsetPaginatedQuery from '@/hooks/useOffsetPaginatedQuery';
import { useSource } from '@/source';
import { useIntersectionObserver } from '@/utils';

import ChartContainer from './charts/ChartContainer';
import MVOptimizationIndicator from './MaterializedViews/MVOptimizationIndicator';
import { SQLPreview } from './ChartSQLPreview';

// TODO: Support clicking in to view matched events
export default function DBTableChart({
  config,
  getRowSearchLink,
  enabled = true,
  queryKeyPrefix,
  onSortingChange,
  sort: controlledSort,
  hiddenColumns = [],
  title,
  toolbarPrefix,
  toolbarSuffix,
  showMVOptimizationIndicator = true,
  variant,
}: {
  config: ChartConfigWithOptTimestamp;
  getRowSearchLink?: (row: any) => string | null;
  queryKeyPrefix?: string;
  enabled?: boolean;
  onSortingChange?: (sort: SortingState) => void;
  sort?: SortingState;
  hiddenColumns?: string[];
  title?: React.ReactNode;
  toolbarPrefix?: React.ReactNode[];
  toolbarSuffix?: React.ReactNode[];
  showMVOptimizationIndicator?: boolean;
  variant?: TableVariant;
}) {
  const [sort, setSort] = useState<SortingState>([]);

  const { data: source } = useSource({ id: config.source });

  const effectiveSort = useMemo(
    () => controlledSort || sort,
    [controlledSort, sort],
  );

  const handleSortingChange = useCallback(
    (newSort: SortingState) => {
      setSort(newSort);
      if (onSortingChange) {
        onSortingChange(newSort);
      }
    },
    [onSortingChange],
  );

  const queriedConfig = useMemo(() => {
    const _config = convertToTableChartConfig(config);

    if (effectiveSort.length) {
      _config.orderBy = effectiveSort.map(o => {
        return {
          valueExpression: o.id,
          ordering: o.desc ? 'DESC' : 'ASC',
        };
      });
    }
    return _config;
  }, [config, effectiveSort]);

  const { data: mvOptimizationData } =
    useMVOptimizationExplanation(queriedConfig);

  const { data, fetchNextPage, hasNextPage, isLoading, isError, error } =
    useOffsetPaginatedQuery(queriedConfig, {
      enabled,
      queryKeyPrefix,
    });
  const { observerRef: fetchMoreRef } = useIntersectionObserver(fetchNextPage);

  // Returns an array of aliases, so we can check if something is using an alias
  const aliasMap = useMemo(() => {
    // If the config.select is a string, we can't infer this.
    // One day, we could potentially run this through chSqlToAliasMap but AST parsing
    //  doesn't work for most DBTableChart queries.
    if (typeof config.select === 'string') {
      return [];
    }
    return config.select.reduce((acc, select) => {
      if (select.alias) {
        acc.push(select.alias);
      }
      return acc;
    }, [] as string[]);
  }, [config.select]);
  const columns = useMemo(() => {
    const rows = data?.data ?? [];
    if (rows.length === 0) {
      return [];
    }

    let groupByKeys: string[] = [];
    if (queriedConfig.groupBy && typeof queriedConfig.groupBy === 'string') {
      groupByKeys = queriedConfig.groupBy.split(',').map(v => v.trim());
    }

    return Object.keys(rows?.[0])
      .filter(key => !hiddenColumns.includes(key))
      .map(key => ({
        // If it's an alias, wrap in quotes to support a variety of formats (ex "Time (ms)", "Req/s", etc)
        id: aliasMap.includes(key) ? `"${key}"` : key,
        dataKey: key,
        displayName: key,
        numberFormat: groupByKeys.includes(key)
          ? undefined
          : config.numberFormat,
      }));
  }, [
    config.numberFormat,
    aliasMap,
    queriedConfig.groupBy,
    data,
    hiddenColumns,
  ]);

  const toolbarItemsMemo = useMemo(() => {
    const allToolbarItems = [];

    if (toolbarPrefix && toolbarPrefix.length > 0) {
      allToolbarItems.push(...toolbarPrefix);
    }

    if (source && showMVOptimizationIndicator) {
      allToolbarItems.push(
        <MVOptimizationIndicator
          key="db-table-chart-mv-indicator"
          config={queriedConfig}
          source={source}
          variant="icon"
        />,
      );
    }

    const dateRangeIndicator = buildMVDateRangeIndicator({
      mvOptimizationData,
      originalDateRange: queriedConfig.dateRange,
    });

    if (dateRangeIndicator) {
      allToolbarItems.push(dateRangeIndicator);
    }

    if (toolbarSuffix && toolbarSuffix.length > 0) {
      allToolbarItems.push(...toolbarSuffix);
    }

    return allToolbarItems;
  }, [
    toolbarPrefix,
    toolbarSuffix,
    source,
    showMVOptimizationIndicator,
    mvOptimizationData,
    queriedConfig,
  ]);

  return (
    <ChartContainer title={title} toolbarItems={toolbarItemsMemo}>
      {isLoading && !data ? (
        <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
          Loading Chart Data...
        </div>
      ) : isError && error ? (
        <div className="h-100 w-100 align-items-center justify-content-center text-muted overflow-scroll">
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
      ) : data?.data.length === 0 ? (
        <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
          No data found within time range.
        </div>
      ) : (
        <Table
          data={data?.data ?? []}
          columns={columns}
          getRowSearchLink={getRowSearchLink}
          sorting={effectiveSort}
          onSortingChange={handleSortingChange}
          variant={variant}
          tableBottom={
            hasNextPage && (
              <Text ref={fetchMoreRef} ta="center">
                Loading...
              </Text>
            )
          }
        />
      )}
    </ChartContainer>
  );
}
