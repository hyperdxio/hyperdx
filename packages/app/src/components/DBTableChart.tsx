import { useMemo, useRef, useState } from 'react';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import {
  ChartConfigWithDateRange,
  ChartConfigWithOptDateRange,
} from '@hyperdx/common-utils/dist/types';
import { Box, Code, Text } from '@mantine/core';
import { SortingState } from '@tanstack/react-table';

import { Table } from '@/HDXMultiSeriesTableChart';
import { useAliasMapFromChartConfig } from '@/hooks/useChartConfig';
import useOffsetPaginatedQuery from '@/hooks/useOffsetPaginatedQuery';
import { omit, useIntersectionObserver } from '@/utils';

import { SQLPreview } from './ChartSQLPreview';

// TODO: Support clicking in to view matched events
export default function DBTableChart({
  config,
  getRowSearchLink,
  enabled = true,
  queryKeyPrefix,
}: {
  config: ChartConfigWithOptDateRange;
  getRowSearchLink?: (row: any) => string;
  queryKeyPrefix?: string;
  enabled?: boolean;
}) {
  const [sort, setSort] = useState<SortingState>([]);

  const queriedConfig = (() => {
    const _config = omit(config, ['granularity']);
    if (!_config.limit) {
      _config.limit = { limit: 200 };
    }
    if (_config.groupBy && typeof _config.groupBy === 'string') {
      _config.orderBy = _config.groupBy;
    }

    if (sort.length) {
      _config.orderBy = sort?.map(o => {
        return {
          valueExpression: o.id,
          ordering: o.desc ? 'DESC' : 'ASC',
        };
      });
    }
    return _config;
  })();

  const { data, fetchNextPage, hasNextPage, isLoading, isError, error } =
    useOffsetPaginatedQuery(queriedConfig as ChartConfigWithDateRange, {
      enabled,
      queryKeyPrefix,
    });
  const { observerRef: fetchMoreRef } = useIntersectionObserver(fetchNextPage);

  // Get the alias map from the config so we resolve correct column ids
  const { data: aliasMap } = useAliasMapFromChartConfig(queriedConfig);
  const columns = useMemo(() => {
    const rows = data?.data ?? [];
    if (rows.length === 0) {
      return [];
    }

    let groupByKeys: string[] = [];
    if (queriedConfig.groupBy && typeof queriedConfig.groupBy === 'string') {
      groupByKeys = queriedConfig.groupBy.split(',').map(v => v.trim());
    }
    return Object.keys(rows?.[0]).map(key => ({
      id: aliasMap?.[key] ?? key,
      dataKey: key,
      displayName: key,
      numberFormat: groupByKeys.includes(key) ? undefined : config.numberFormat,
    }));
  }, [config.numberFormat, aliasMap, queriedConfig.groupBy, data]);

  return isLoading && !data ? (
    <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
      Loading Chart Data...
    </div>
  ) : isError && error ? (
    <div className="h-100 w-100 align-items-center justify-content-center text-muted">
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
      sorting={sort}
      onSortingChange={setSort}
      tableBottom={
        hasNextPage && (
          <Text ref={fetchMoreRef} ta="center">
            Loading...
          </Text>
        )
      }
    />
  );
}
