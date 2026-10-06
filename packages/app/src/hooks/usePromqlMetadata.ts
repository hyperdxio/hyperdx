import { useQuery } from '@tanstack/react-query';

import { prometheusApi } from '@/api';
import { useMetadataQueryAttribution } from '@/queryAttribution';

export function usePromqlMetricNames(
  connectionId: string | undefined,
  database?: string,
  table?: string,
) {
  const attribution = useMetadataQueryAttribution();
  return useQuery<string[]>({
    queryKey: ['promql-metric-names', connectionId, database, table],
    queryFn: async () => {
      if (!connectionId) return [];
      const resp = await prometheusApi.labelValues({
        label: '__name__',
        connectionId,
        database,
        table,
        attribution,
      });
      return resp.data ?? [];
    },
    enabled: !!connectionId,
    staleTime: 60_000,
  });
}

/** The label names carried by any series the PromQL connection can see. */
export function usePromqlLabelNames(
  connectionId: string | undefined,
  database?: string,
  table?: string,
) {
  const attribution = useMetadataQueryAttribution();
  return useQuery<string[]>({
    queryKey: ['promql-label-names', connectionId, database, table],
    queryFn: async () => {
      if (!connectionId) return [];
      const resp = await prometheusApi.labels({
        connectionId,
        database,
        table,
        attribution,
      });
      return resp.data ?? [];
    },
    enabled: !!connectionId,
    staleTime: 60_000,
  });
}
