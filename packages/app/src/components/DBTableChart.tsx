import { useCallback, useMemo, useState } from 'react';
import { isRatioChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import {
  isBuilderChartConfig,
  isPromqlChartConfig,
  isRawSqlChartConfig,
} from '@hyperdx/common-utils/dist/guards';
import {
  ChartConfigWithOptTimestamp,
  ChartPaletteToken,
  ColorCondition,
} from '@hyperdx/common-utils/dist/types';
import { Text } from '@mantine/core';
import { SortingState } from '@tanstack/react-table';

import {
  buildMVDateRangeIndicator,
  convertToTableChartConfig,
} from '@/ChartUtils';
import { Table, TableVariant } from '@/HDXMultiSeriesTableChart';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';
import useOffsetPaginatedQuery from '@/hooks/useOffsetPaginatedQuery';
import { useOnClickLinkBuilder } from '@/hooks/useOnClickLinkBuilder';
import { useChartNumberFormats, useSource } from '@/source';
import { useIntersectionObserver } from '@/utils';

import ChartContainer from './charts/ChartContainer';
import ChartErrorState, {
  ChartErrorStateVariant,
} from './charts/ChartErrorState';
import { getClientSideSortingFn } from './DBTable/sorting';
import MVOptimizationIndicator from './MaterializedViews/MVOptimizationIndicator';

export default function DBTableChart({
  config,
  getRowSearchLink,
  enabled = true,
  queryKeyPrefix,
  onSortingChange,
  sort: controlledSort,
  hiddenColumns,
  title,
  toolbarPrefix,
  toolbarSuffix,
  showMVOptimizationIndicator = true,
  variant,
  errorVariant,
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
  errorVariant?: ChartErrorStateVariant;
}) {
  const [sort, setSort] = useState<SortingState>([]);

  const { data: source } = useSource({
    id: config.source,
  });

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
    if (isRawSqlChartConfig(config)) return config;
    if (isPromqlChartConfig(config)) return config;

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

  const { data: mvOptimizationData } = useMVOptimizationExplanation(
    isBuilderChartConfig(queriedConfig) ? queriedConfig : undefined,
  );

  const { data, fetchNextPage, hasNextPage, isLoading, isError, error } =
    useOffsetPaginatedQuery(queriedConfig, {
      enabled,
      queryKeyPrefix,
    });
  const { observerRef: fetchMoreRef } = useIntersectionObserver(fetchNextPage);

  // Returns an array of aliases, so we can check if something is using an alias
  const aliasMap = useMemo(() => {
    if (isRawSqlChartConfig(config) || isPromqlChartConfig(config)) {
      return [];
    }

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
  }, [config]);

  const { formatByColumn } = useChartNumberFormats(queriedConfig, data?.meta);

  // Per-column color config (static token + ordered conditional rules) for
  // builder table tiles. Mirrors `formatByColumn`: each series in `select`
  // maps by index to its result column (meta[i].name), so these maps key
  // identically and the columns memo consumes them the same way. Color targets
  // aggregation (series) columns only; group-by columns are not select items
  // and never appear here. Ratio configs merge two series into one column, so
  // per-column color is skipped (matching the numberFormat treatment).
  const { colorByColumn, rulesByColumn } = useMemo(() => {
    const colorByColumn = new Map<string, ChartPaletteToken>();
    const rulesByColumn = new Map<string, ColorCondition[]>();
    const meta = data?.meta;
    if (
      !meta ||
      !isBuilderChartConfig(queriedConfig) ||
      !Array.isArray(queriedConfig.select) ||
      isRatioChartConfig(queriedConfig.select, queriedConfig)
    ) {
      return { colorByColumn, rulesByColumn };
    }
    for (let i = 0; i < queriedConfig.select.length; i++) {
      const series = queriedConfig.select[i];
      const key = meta[i]?.name;
      if (key == null) continue;
      if (series.color) {
        colorByColumn.set(key, series.color);
      }
      if (series.colorRules && series.colorRules.length > 0) {
        rulesByColumn.set(key, series.colorRules);
      }
    }
    return { colorByColumn, rulesByColumn };
  }, [data?.meta, queriedConfig]);

  const columns = useMemo(() => {
    const rows = data?.data ?? [];
    if (rows.length === 0) {
      return [];
    }

    const firstRow = rows.at(0);
    const allKeys = firstRow ? Object.keys(firstRow) : [];

    // We extract groupBy keys by counting the series columns to avoid parsing
    // the groupBy string, which may have complex expressions and aliases, making
    // it difficult to reliably parse out the individual group by keys.
    let groupByKeys: string[] = [];
    if (
      isBuilderChartConfig(queriedConfig) &&
      Array.isArray(queriedConfig.select)
    ) {
      const isRatio = isRatioChartConfig(queriedConfig.select, queriedConfig);
      const seriesCount = isRatio ? 1 : queriedConfig.select.length;
      const groupByCount = allKeys.length - seriesCount;
      groupByKeys = groupByCount > 0 ? allKeys.slice(-groupByCount) : [];
    }

    // Builder table configs may opt to render Group By columns
    // to the left of series columns.
    let orderedKeys = [...allKeys];
    if (
      isBuilderChartConfig(queriedConfig) &&
      queriedConfig.groupByColumnsOnLeft &&
      Array.isArray(queriedConfig.select)
    ) {
      const seriesKeys = allKeys.filter(key => !groupByKeys.includes(key));
      orderedKeys = [...groupByKeys, ...seriesKeys];
    }

    return orderedKeys
      .filter(key => !hiddenColumns?.includes(key))
      .map(key => ({
        // If it's an alias, wrap in quotes to support a variety of formats (ex "Time (ms)", "Req/s", etc)
        id: aliasMap.includes(key) ? `"${key}"` : key,
        dataKey: key,
        displayName: key,
        numberFormat: groupByKeys.includes(key)
          ? undefined
          : (formatByColumn.get(key) ?? queriedConfig.numberFormat),
        color: groupByKeys.includes(key) ? undefined : colorByColumn.get(key),
        colorRules: groupByKeys.includes(key)
          ? undefined
          : rulesByColumn.get(key),
        sortingFn: getClientSideSortingFn(data?.meta, key),
      }));
  }, [
    data,
    queriedConfig,
    hiddenColumns,
    aliasMap,
    formatByColumn,
    colorByColumn,
    rulesByColumn,
  ]);

  const toolbarItemsMemo = useMemo(() => {
    const allToolbarItems = [];

    if (toolbarPrefix && toolbarPrefix.length > 0) {
      allToolbarItems.push(...toolbarPrefix);
    }

    if (
      source &&
      showMVOptimizationIndicator &&
      isBuilderChartConfig(queriedConfig)
    ) {
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

  const getRowAction = useOnClickLinkBuilder({
    onClick: config.onClick,
    dateRange: queriedConfig.dateRange,
  });

  return (
    <ChartContainer title={title} toolbarItems={toolbarItemsMemo}>
      {isLoading && !data ? (
        <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
          Loading Chart Data...
        </div>
      ) : isError && error ? (
        <ChartErrorState error={error} variant={errorVariant} />
      ) : data?.data.length === 0 ? (
        <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
          No data found within time range.
        </div>
      ) : (
        <Table
          data={data?.data ?? []}
          columns={columns}
          getRowAction={getRowAction ?? undefined}
          getRowSearchLink={getRowAction ? undefined : getRowSearchLink}
          sorting={effectiveSort}
          enableClientSideSorting={isRawSqlChartConfig(config)}
          onSortingChange={handleSortingChange}
          variant={variant}
          alternateRowBackground={!!queriedConfig.alternateRowBackground}
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
