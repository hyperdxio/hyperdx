import { Box, Code, Flex, Text } from '@mantine/core';

import { ClickHouseQueryError } from '@/clickhouse';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { ChartConfigWithDateRange } from '@/renderChartConfig';
import { formatNumber, omit } from '@/utils';

import { SQLPreview } from './ChartSQLPreview';

export default function DBNumberChart({
  config,
  enabled = true,
  queryKeyPrefix,
}: {
  config: ChartConfigWithDateRange;
  queryKeyPrefix?: string;
  enabled?: boolean;
}) {
  const queriedConfig = omit(config, ['granularity', 'groupBy']);
  const { data, isLoading, isError, error } = useQueriedChartConfig(
    queriedConfig,
    {
      placeholderData: (prev: any) => prev,
      queryKey: [queryKeyPrefix, queriedConfig],
      enabled,
    },
  );

  const number = formatNumber(
    (Object.values(data?.data?.[0] ?? {})?.[0] ?? Number.NaN) as number,
    config.numberFormat,
  );

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
    <Flex align="center" justify="center" h="100%" style={{ flexGrow: 1 }}>
      <Text size="4rem">{number ?? 'N/A'}</Text>
    </Flex>
  );
}
