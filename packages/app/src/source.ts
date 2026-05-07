import { useMemo } from 'react';
import objectHash from 'object-hash';
import { isBuilderChartConfig } from '@berg/common-utils/dist/guards';
import {
  ChartConfigWithOptDateRange,
  NumberFormat,
  SourceKind,
  TSource,
  TSourceNoId,
} from '@berg/common-utils/dist/types';
import {
  useMutation,
  useQuery,
  useQueryClient,
  UseQueryResult,
} from '@tanstack/react-query';

import { hdxServer } from '@/api';
import { IS_LOCAL_MODE } from '@/config';
import { localSources } from '@/localStore';

export function getSourceValidationNotificationId(sourceId: string) {
  return `source-validation-${sourceId}`;
}

export function useSources() {
  return useQuery({
    queryKey: ['sources'],
    queryFn: async () => {
      if (IS_LOCAL_MODE) {
        return localSources.getAll();
      }
      return hdxServer('sources').json<TSource[]>();
    },
  });
}

// Berg has a single Source kind ('Table'); the kinds filter is retained
// only to keep call sites compiling and is effectively a no-op.
export function useSource(opts: {
  id?: string | null;
  kinds?: SourceKind[];
}): UseQueryResult<TSource | undefined>;
export function useSource({
  id,
  kinds,
}: {
  id?: string | null;
  kinds?: SourceKind[];
}) {
  return useQuery({
    queryKey: ['sources'],
    queryFn: async () => {
      if (IS_LOCAL_MODE) {
        return localSources.getAll();
      }
      return hdxServer('sources').json<TSource[]>();
    },
    select: (data: TSource[]) => {
      const source = data.find(s => s.id === id);
      if (source && kinds?.length && !kinds.includes(source.kind))
        return undefined;
      return source;
    },
    enabled: id != null,
  });
}

export function useUpdateSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ source }: { source: TSource }) => {
      if (IS_LOCAL_MODE) {
        localSources.update(source.id, source);
        return;
      }
      return hdxServer(`sources/${source.id}`, {
        method: 'PUT',
        json: source,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
  });
}

export function useCreateSource() {
  const queryClient = useQueryClient();

  const mut = useMutation({
    mutationFn: async ({ source }: { source: TSourceNoId }) => {
      if (IS_LOCAL_MODE) {
        const existing = localSources.getAll().find(
          stored =>
            objectHash({
              kind: stored.kind,
              catalog: stored.catalog,
              database: stored.database,
              table: stored.table,
            }) ===
            objectHash({
              kind: source.kind,
              catalog: source.catalog,
              database: source.database,
              table: source.table,
            }),
        );
        if (existing) {
          // Replace the existing source in-place rather than duplicating
          localSources.update(existing.id, source);
          return { ...source, id: existing.id };
        }
        return localSources.create(source);
      }

      return hdxServer(`sources`, {
        method: 'POST',
        json: source,
      }).json<TSource>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
  });

  return mut;
}

export function useDeleteSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (arg: string | { id: string }) => {
      const id = typeof arg === 'string' ? arg : arg.id;
      if (IS_LOCAL_MODE) {
        localSources.delete(id);
        return;
      }
      return hdxServer(`sources/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
  });
}

/**
 * Berg-flavoured save mutation: PUT for an existing source (`id` set),
 * POST otherwise. Used by the SourcesList page and the EditSourceModal
 * shared between "Save as Source" (Catalog) and "Edit" (list).
 */
export function useSaveSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      source: TSourceNoId & { id?: string },
    ): Promise<TSource> => {
      if (IS_LOCAL_MODE) {
        if (source.id) {
          localSources.update(source.id, source as TSource);
          return source as TSource;
        }
        return localSources.create(source);
      }
      if (source.id) {
        // PUT returns no body in our API — round-trip through the cached list.
        await hdxServer(`sources/${source.id}`, {
          method: 'PUT',
          json: source,
        });
        return source as TSource;
      }
      return hdxServer(`sources`, {
        method: 'POST',
        json: source,
      }).json<TSource>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
  });
}

/**
 * Hook that resolves the effective numberFormat for a chart config.
 * If the config has an explicit numberFormat, returns it; otherwise undefined.
 *
 * Berg-native sources are observability-agnostic — there is no source-side
 * duration expression to auto-detect. Charts wanting a duration format must
 * set `numberFormat` explicitly on the config.
 */
export function useResolvedNumberFormat(
  config: ChartConfigWithOptDateRange,
): NumberFormat | undefined {
  return useMemo(() => {
    if (config.numberFormat) return config.numberFormat;
    if (!isBuilderChartConfig(config)) return undefined;
    return undefined;
  }, [config]);
}
