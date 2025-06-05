import { renderChartConfig } from '@hyperdx/common-utils/dist/renderChartConfig';
import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { useQuery, UseQueryOptions } from '@tanstack/react-query';

import { getClickhouseClient } from '@/clickhouse';
import { getMetadata } from '@/metadata';

export function useExplainQuery(
  _config: ChartConfigWithDateRange,
  options?: Omit<UseQueryOptions<any>, 'queryKey' | 'queryFn'>,
) {
  const config = {
    ..._config,
    with: undefined,
  };
  const clickhouseClient = getClickhouseClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['explain', config],
    queryFn: async ({ signal }) => {
      const query = await renderChartConfig(config, getMetadata());
      const response = await clickhouseClient.query<'JSONEachRow'>({
        query: `EXPLAIN ESTIMATE ${query.sql}`,
        query_params: query.params,
        format: 'JSONEachRow',
        abort_signal: signal,
        connectionId: config.connection,
      });
      return response.json();
    },
    retry: false,
    staleTime: 1000 * 60,
    ...options,
  });

  return { data, isLoading, error };
}
