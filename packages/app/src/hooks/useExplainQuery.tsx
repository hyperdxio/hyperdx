import { useQuery, UseQueryOptions } from '@tanstack/react-query';

import { sendQuery } from '@/clickhouse';
import {
  ChartConfigWithDateRange,
  renderChartConfig,
} from '@/renderChartConfig';

export function useExplainQuery(
  config: ChartConfigWithDateRange,
  options?: Omit<UseQueryOptions<any>, 'queryKey' | 'queryFn'>,
) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['explain', config],
    queryFn: async ({ signal }) => {
      const query = await renderChartConfig(config);
      const response = await sendQuery<'JSONEachRow'>({
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
