import { pick } from 'lodash';
import { DashboardFilter } from '@hyperdx/common-utils/dist/types';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { useSources } from '@/source';

import { useMetadataWithSettings } from './useMetadata';

export function useDashboardFilterKeyValues({
  filters,
  dateRange,
}: {
  filters: DashboardFilter[];
  dateRange: [Date, Date];
}) {
  const metadata = useMetadataWithSettings();
  const { data: sources, isLoading: isLoadingSources } = useSources();

  return useQuery({
    queryKey: ['dashboard-filters-key-values', filters, dateRange],
    queryFn: async ({ signal }) => {
      const filtersBySourceId = new Map<string, DashboardFilter[]>();
      for (const filter of filters) {
        if (!filtersBySourceId.has(filter.source)) {
          filtersBySourceId.set(filter.source, [filter]);
        } else {
          filtersBySourceId.get(filter.source)!.push(filter);
        }
      }

      const keyValuesBySource = await Promise.all(
        Array.from(filtersBySourceId.entries())
          .filter(([sourceId]) => sources?.some(s => s.id === sourceId))
          .map(([sourceId, filters]) => {
            const source = sources!.find(s => s.id === sourceId)!;

            return metadata.getKeyValuesWithMVs({
              chartConfig: {
                ...pick(source, [
                  'timestampValueExpression',
                  'connection',
                  'from',
                ]),
                source: sourceId,
                dateRange,
                where: '',
                whereLanguage: 'sql',
                select: '',
              },
              keys: filters.map(f => f.expression),
              limit: 10000,
              disableRowLimit: true,
              source,
              signal,
            });
          }),
      );

      return new Map(
        keyValuesBySource.flat().map(({ key, value }) => [key, value]),
      );
    },
    enabled: !isLoadingSources && filters.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60 * 5, // Cache every 5 min
  });
}
