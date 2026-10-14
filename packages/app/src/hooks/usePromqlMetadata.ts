import { useQuery } from '@tanstack/react-query';

import { prometheusApi } from '@/api';
import { useMetadataQueryAttribution } from '@/queryAttribution';

export function usePromqlMetricNames(sourceId: string | undefined) {
  const attribution = useMetadataQueryAttribution();
  return useQuery<string[]>({
    queryKey: ['promql-metric-names', sourceId],
    queryFn: async () => {
      if (!sourceId) return [];
      const resp = await prometheusApi.labelValues({
        label: '__name__',
        sourceId,
        attribution,
      });
      return resp.data ?? [];
    },
    enabled: !!sourceId,
    staleTime: 60_000,
  });
}

/** The label names carried by any series the PromQL source can see. */
export function usePromqlLabelNames(sourceId: string | undefined) {
  const attribution = useMetadataQueryAttribution();
  return useQuery<string[]>({
    queryKey: ['promql-label-names', sourceId],
    queryFn: async () => {
      if (!sourceId) return [];
      const resp = await prometheusApi.labels({ sourceId, attribution });
      return resp.data ?? [];
    },
    enabled: !!sourceId,
    staleTime: 60_000,
  });
}
