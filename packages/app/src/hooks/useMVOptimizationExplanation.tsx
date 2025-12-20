import {
  MVOptimizationExplanation,
  tryOptimizeConfigWithMaterializedViewWithExplanations,
} from '@hyperdx/common-utils/dist/core/materializedViews';
import { ChartConfigWithOptDateRange } from '@hyperdx/common-utils/dist/types';
import {
  keepPreviousData,
  useQuery,
  UseQueryOptions,
} from '@tanstack/react-query';

import { useClickhouseClient } from '@/clickhouse';
import { useSource } from '@/source';

import { useMetadataWithSettings } from './useMetadata';

export interface MVOptimizationExplanationResult {
  optimizedConfig?: ChartConfigWithOptDateRange;
  explanations: MVOptimizationExplanation[];
}

export function useMVOptimizationExplanation(
  config: ChartConfigWithOptDateRange | undefined,
  options?: UseQueryOptions<MVOptimizationExplanationResult>,
) {
  const { enabled = true } = options || {};
  const metadata = useMetadataWithSettings();
  const clickhouseClient = useClickhouseClient();

  const { data: source, isLoading: isLoadingSource } = useSource({
    id: config?.source,
  });

  return useQuery<MVOptimizationExplanationResult>({
    queryKey: ['optimizationExplanation', config],
    queryFn: async ({ signal }) => {
      if (!config || !source) {
        return {
          explanations: [],
        };
      }

      return await tryOptimizeConfigWithMaterializedViewWithExplanations(
        config,
        metadata,
        clickhouseClient,
        signal,
        source,
      );
    },
    placeholderData: keepPreviousData,
    ...options,
    enabled: enabled && !isLoadingSource && !!config && !!source,
  });
}
