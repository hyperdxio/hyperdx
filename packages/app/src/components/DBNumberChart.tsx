import { useMemo } from 'react';
import {
  isBuilderChartConfig,
  isRawSqlChartConfig,
} from '@berg/common-utils/dist/guards';
import {
  BuilderChartConfigWithDateRange,
  RawSqlConfigWithDateRange,
} from '@berg/common-utils/dist/types';
import { Flex, Text } from '@mantine/core';

import { convertToNumberChartConfig } from '@/ChartUtils';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useResolvedNumberFormat } from '@/source';
import { formatNumber } from '@/utils';

import ChartContainer from './charts/ChartContainer';
import ChartErrorState, {
  ChartErrorStateVariant,
} from './charts/ChartErrorState';

// Lightweight Berg replacement for the deleted ClickHouse JSDataType numeric
// detection. Athena/Trino numeric type names; matches the meta.type values
// emitted by the Berg /v1/query response.
function isAthenaNumericType(type: string | undefined): boolean {
  if (!type) return false;
  const t = type.toLowerCase();
  return (
    t.startsWith('bigint') ||
    t.startsWith('integer') ||
    t.startsWith('int') ||
    t.startsWith('smallint') ||
    t.startsWith('tinyint') ||
    t.startsWith('double') ||
    t.startsWith('real') ||
    t.startsWith('float') ||
    t.startsWith('decimal') ||
    t === 'number'
  );
}

export default function DBNumberChart({
  config,
  enabled = true,
  queryKeyPrefix,
  title,
  toolbarPrefix,
  toolbarSuffix,
  errorVariant,
}: {
  config: BuilderChartConfigWithDateRange | RawSqlConfigWithDateRange;
  queryKeyPrefix?: string;
  enabled?: boolean;
  title?: React.ReactNode;
  toolbarPrefix?: React.ReactNode[];
  toolbarSuffix?: React.ReactNode[];
  errorVariant?: ChartErrorStateVariant;
}) {
  const queriedConfig = useMemo(
    () =>
      isBuilderChartConfig(config)
        ? convertToNumberChartConfig(config)
        : config,
    [config],
  );

  const { data, isLoading, isError, error } = useQueriedChartConfig(
    queriedConfig,
    {
      placeholderData: (prev: any) => prev,
      queryKey: [queryKeyPrefix, queriedConfig],
      enabled,
    },
  );

  // The value is the first numeric value in the first row of the result
  const valueColumn = data?.meta?.find((m: { name: string; type: string }) =>
    isAthenaNumericType(m.type),
  );
  const resultError =
    data && !valueColumn && isRawSqlChartConfig(queriedConfig)
      ? new Error(
          `No numeric columns found in result column metadata. Make sure a numeric column exists in the result set.\n\nResult Metadata: ${JSON.stringify(data.meta)}`,
        )
      : error;

  const resolvedNumberFormat = useResolvedNumberFormat(config);

  const value = valueColumn
    ? data?.data?.[0]?.[valueColumn.name]
    : (Object.values(data?.data?.[0] ?? {})?.[0] ?? Number.NaN);
  const formattedValue = formatNumber(value as number, resolvedNumberFormat);

  const toolbarItemsMemo = useMemo(() => {
    const allToolbarItems = [];

    if (toolbarPrefix && toolbarPrefix.length > 0) {
      allToolbarItems.push(...toolbarPrefix);
    }

    if (toolbarSuffix && toolbarSuffix.length > 0) {
      allToolbarItems.push(...toolbarSuffix);
    }

    return allToolbarItems;
  }, [toolbarPrefix, toolbarSuffix]);

  return (
    <ChartContainer title={title} toolbarItems={toolbarItemsMemo}>
      {isLoading && !data ? (
        <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
          Loading Chart Data...
        </div>
      ) : isError ? (
        <ChartErrorState error={error} variant={errorVariant} />
      ) : resultError ? (
        <ChartErrorState error={resultError} variant={errorVariant} />
      ) : data?.data.length === 0 ? (
        <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
          No data found within time range.
        </div>
      ) : (
        <Flex align="center" justify="center" h="100%" style={{ flexGrow: 1 }}>
          <Text size="4rem">{formattedValue ?? 'N/A'}</Text>
        </Flex>
      )}
    </ChartContainer>
  );
}
