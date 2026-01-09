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

export interface MVOptimizationExplanationResult<
  C extends ChartConfigWithOptDateRange = ChartConfigWithOptDateRange,
> {
  optimizedConfig?: C;
  explanations: MVOptimizationExplanation[];
}

export function useMVOptimizationExplanation<
  C extends ChartConfigWithOptDateRange,
>(
  config: C | undefined,
  options?: Partial<UseQueryOptions<MVOptimizationExplanationResult<C>>>,
) {
  const { enabled = true } = options || {};
  const metadata = useMetadataWithSettings();
  const clickhouseClient = useClickhouseClient();

  const { data: source, isLoading: isLoadingSource } = useSource({
    id: config?.source,
  });

  return useQuery<MVOptimizationExplanationResult<C>>({
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
    staleTime: 5000,
    ...options,
    enabled: enabled && !isLoadingSource && !!config && !!source,
  });
}
