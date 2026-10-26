import { QueryAttribution } from '@hyperdx/common-utils/dist/clickhouse';
import { useQuery } from '@tanstack/react-query';

import { prometheusApi } from '@/api';
import { useMetadataQueryAttribution } from '@/queryAttribution';

type PromqlLabelLookup = {
  sourceId: string;
  start?: number;
  end?: number;
  attribution?: QueryAttribution;
};

/** The label lookup APIs accept whole seconds. */
export const toPromqlSeconds = (dateRange: [Date, Date]) => ({
  start: Math.floor(dateRange[0].getTime() / 1000),
  end: Math.ceil(dateRange[1].getTime() / 1000),
});

export async function fetchPromqlLabelNames(
  params: PromqlLabelLookup,
): Promise<string[]> {
  const resp = await prometheusApi.labels(params);
  if (resp.status === 'error') {
    throw new Error(resp.error ?? 'Label names query failed');
  }
  return resp.data ?? [];
}

export async function fetchPromqlLabelValues(
  params: PromqlLabelLookup & { label: string; match?: string },
): Promise<string[]> {
  const resp = await prometheusApi.labelValues(params);
  if (resp.status === 'error') {
    throw new Error(resp.error ?? 'Label values query failed');
  }
  return resp.data ?? [];
}

export function usePromqlMetricNames(sourceId: string | undefined) {
  const attribution = useMetadataQueryAttribution();
  return useQuery<string[]>({
    queryKey: ['promql-metric-names', sourceId],
    queryFn: async () => {
      if (!sourceId) return [];
      return fetchPromqlLabelValues({
        label: '__name__',
        sourceId,
        attribution,
      });
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
      return fetchPromqlLabelNames({ sourceId, attribution });
    },
    enabled: !!sourceId,
    staleTime: 60_000,
  });
}
