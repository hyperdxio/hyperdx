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

export function usePromqlLabelNames(
  connectionId: string | undefined,
  metricName: string | undefined,
  database?: string,
  table?: string,
) {
  // For now, fetch all label names (not filtered by metric)
  // A metric-specific endpoint could be added later
  return useQuery<string[]>({
    queryKey: ['promql-label-names', connectionId, metricName, database, table],
    queryFn: async () => {
      if (!connectionId || !metricName) return [];
      // Use a generic labels endpoint — for now return empty
      // since the standard Prometheus API doesn't have a per-metric label names endpoint
      return [];
    },
    enabled: !!connectionId && !!metricName,
    staleTime: 60_000,
  });
}
