import { useQuery } from '@tanstack/react-query';

import { prometheusApi } from '@/api';

export function usePromqlMetricNames(
  connectionId: string | undefined,
  database?: string,
  table?: string,
) {
  return useQuery<string[]>({
    queryKey: ['promql-metric-names', connectionId, database, table],
    queryFn: async () => {
      if (!connectionId) return [];
      const resp = await prometheusApi.labelValues({
        label: '__name__',
        connectionId,
        database,
        table,
      });
      return resp.data ?? [];
    },
    enabled: !!connectionId,
    staleTime: 60_000,
  });
}
