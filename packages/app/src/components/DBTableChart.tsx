import { useMemo } from 'react';
import { ChartConfigWithOptDateRange } from '@hyperdx/common-utils/dist/renderChartConfig';
import { Box, Code, Text } from '@mantine/core';

import { ClickHouseQueryError } from '@/clickhouse';
import { Table } from '@/HDXMultiSeriesTableChart';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { omit } from '@/utils';

import { SQLPreview } from './ChartSQLPreview';

// TODO: Support clicking in to view matched events
export default function DBTableChart({
  config,
  onSortClick,
  getRowSearchLink,
  enabled = true,
  queryKeyPrefix,
}: {
  config: ChartConfigWithOptDateRange;
  onSortClick?: (seriesIndex: number) => void;
  getRowSearchLink?: (row: any) => string;
  queryKeyPrefix?: string;
  enabled?: boolean;
}) {
  const queriedConfig = omit(config, ['granularity']);
  const { data, isLoading, isError, error } = useQueriedChartConfig(
    queriedConfig,
    {
      placeholderData: (prev: any) => prev,
      queryKey: [queryKeyPrefix, queriedConfig],
      enabled,
    },
  );

  const columns = useMemo(() => {
    const rows = data?.data ?? [];
    if (rows.length === 0) {
      return [];
    }

    return Object.keys(rows?.[0]).map(key => ({
      dataKey: key,
      displayName: key,
      numberFormat: config.numberFormat,
    }));
  }, [config.numberFormat, data]);

  return isLoading && !data ? (
    <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
      Loading Chart Data...
    </div>
  ) : isError ? (
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
    />
  );
}
