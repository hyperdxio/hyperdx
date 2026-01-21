import { renderChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import { ChartConfigWithOptDateRange } from '@hyperdx/common-utils/dist/types';
import { useQuery, UseQueryOptions } from '@tanstack/react-query';

import { useClickhouseClient } from '@/clickhouse';
import { useSource } from '@/source';

import { useMetadataWithSettings } from './useMetadata';

export function useExplainQuery(
  _config: ChartConfigWithOptDateRange,
  options?: Omit<UseQueryOptions<any>, 'queryKey' | 'queryFn'>,
) {
  const config = {
    ..._config,
    with: undefined,
  };
  const clickhouseClient = useClickhouseClient();

  const metadata = useMetadataWithSettings();

  const { data: source, isLoading: isSourceLoading } = useSource({
    id: config?.source,
  });

  return useQuery({
    queryKey: ['explain', config],
    queryFn: async ({ signal }) => {
      const query = await renderChartConfig(
        config,
        metadata,
        source?.querySettings,
      );
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
    enabled: !isSourceLoading,
    ...options,
  });
}
