import { useMemo } from 'react';
import {
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
  useQueryStates,
} from 'nuqs';
import {
  BuilderChartConfigWithDateRange,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import { Group, Loader, MultiSelect, Select, Stack, Text } from '@mantine/core';

import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useColumns } from '@/hooks/useMetadata';
import {
  buildNetflowSankeyConfig,
  buildNetflowSankeyData,
  SankeyDimension,
  SankeyFilterHandler,
} from '@/netflowSankey';
import {
  getDefaultSankeyDimensions,
  getSankeyDimensionOptions,
} from '@/netflowSankeyDimensions';
import { useSource } from '@/source';

import { ChartCard } from './charts/ChartCard';
import ChartContainer from './charts/ChartContainer';
import ChartErrorState from './charts/ChartErrorState';
import EmptyState from './EmptyState';
import NetflowSankeyChart from './NetflowSankeyChart';
import NetflowSankeyTable from './NetflowSankeyTable';

function SankeyResults({
  baseConfig,
  dimensions,
  limit,
  onFilter,
}: {
  baseConfig: BuilderChartConfigWithDateRange;
  dimensions: SankeyDimension[];
  limit: number;
  onFilter?: SankeyFilterHandler;
}) {
  const config = useMemo(
    () => buildNetflowSankeyConfig({ baseConfig, dimensions, limit }),
    [baseConfig, dimensions, limit],
  );
  const { data, isLoading, error } = useQueriedChartConfig(config);
  const graph = useMemo(
    () => buildNetflowSankeyData(data?.data ?? [], dimensions),
    [data, dimensions],
  );
  const rangeSeconds =
    (baseConfig.dateRange[1].getTime() - baseConfig.dateRange[0].getTime()) /
    1000;
  if (error) return <ChartErrorState error={error} />;
  if (isLoading) return <Loader aria-label="Loading Sankey" />;
  if (!graph.paths.length)
    return (
      <EmptyState
        title="No traffic paths found"
        description="Widen the time range or clear your filters to see network traffic."
      />
    );
  return (
    <>
      <NetflowSankeyChart
        data={graph}
        dimensions={dimensions}
        rangeSeconds={rangeSeconds}
        onFilter={onFilter}
      />
      <Text size="xs" c="dimmed">
        Showing {graph.paths.length} of the top {limit} paths by sampled bytes.
        Link widths represent these displayed paths; rates are averaged over the
        selected time range.
      </Text>
      <NetflowSankeyTable
        data={graph}
        dimensions={dimensions}
        rangeSeconds={rangeSeconds}
        onFilter={onFilter}
      />
    </>
  );
}

export default function NetflowSankey({
  baseConfig,
  onFilter,
}: {
  baseConfig: BuilderChartConfigWithDateRange;
  onFilter?: SankeyFilterHandler;
}) {
  const [params, setParams] = useQueryStates({
    sankeyDimensions: parseAsArrayOf(parseAsString),
    sankeyLimit: parseAsInteger.withDefault(20),
  });
  const { data: source } = useSource({
    id: baseConfig.source,
    kinds: [SourceKind.Netflow],
  });
  const {
    data: columns,
    isLoading,
    error,
  } = useColumns({
    databaseName: baseConfig.from.databaseName,
    tableName: baseConfig.from.tableName,
    connectionId: baseConfig.connection ?? '',
  });
  const options = useMemo(
    () => (source ? getSankeyDimensionOptions(source, columns ?? []) : []),
    [source, columns],
  );
  const keys = params.sankeyDimensions ?? getDefaultSankeyDimensions(options);
  const dimensions = keys.flatMap(key =>
    options.filter(option => option.key === key),
  );
  const valid =
    dimensions.length >= 2 &&
    dimensions.length <= 5 &&
    dimensions.length === keys.length &&
    new Set(keys).size === keys.length;
  const limit = [10, 20, 50].includes(params.sankeyLimit)
    ? params.sankeyLimit
    : 20;
  return (
    <ChartCard data-testid="netflow-sankey">
      <ChartContainer title="Traffic paths" disableReactiveContainer>
        <Stack gap="md" py="sm">
          <Group align="start">
            <MultiSelect
              label="Dimensions"
              description="Choose two to five dimensions in left-to-right order."
              aria-label="Sankey dimensions"
              searchable
              clearable
              clearButtonProps={{
                'aria-label': 'Clear Sankey dimensions',
                'aria-hidden': false,
                tabIndex: 0,
              }}
              maxValues={5}
              style={{ flex: 1, minWidth: 240 }}
              data={options.map(option => ({
                value: option.key,
                label: option.label,
              }))}
              value={keys}
              onChange={sankeyDimensions =>
                void setParams({ sankeyDimensions })
              }
            />
            <Select
              label="Path limit"
              aria-label="Sankey path limit"
              w={100}
              data={['10', '20', '50']}
              value={String(limit)}
              onChange={value => void setParams({ sankeyLimit: Number(value) })}
              allowDeselect={false}
            />
          </Group>
          {error ? (
            <ChartErrorState error={error} />
          ) : isLoading || !source ? (
            <Loader aria-label="Loading Sankey dimensions" />
          ) : valid ? (
            <SankeyResults
              baseConfig={baseConfig}
              dimensions={dimensions}
              limit={limit}
              onFilter={onFilter}
            />
          ) : (
            <EmptyState
              title="Choose two to five dimensions"
              description="Select available table columns to connect the traffic paths."
            />
          )}
        </Stack>
      </ChartContainer>
    </ChartCard>
  );
}
