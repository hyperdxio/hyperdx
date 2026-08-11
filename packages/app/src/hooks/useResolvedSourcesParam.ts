import { useEffect, useMemo } from 'react';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { notifications } from '@mantine/notifications';

import { MAX_SEARCH_SOURCES } from '@/defaults';
import { useSources } from '@/source';
import { resolveSourcesParam } from '@/utils/sourceParams';

const EMPTY_SOURCES: TSource[] = [];

/**
 * Resolves the multi-source search param (a list of source IDs or names) to
 * the matching sources, deduped and capped at MAX_SEARCH_SOURCES.
 *
 * Elements that don't match any usable source are dropped from the selection
 * and reported once via a Mantine warning, mirroring useResolvedSourceParam.
 */
export function useResolvedSourcesParam(
  paramValues: string[] | null | undefined,
  { kinds }: { kinds?: SourceKind[] } = {},
): { sources: TSource[] } {
  const { data: allSources } = useSources();

  // Key the memo on a serialized `kinds` so callers can pass inline arrays
  // without breaking memoization.
  const kindsKey = kinds?.join(',');
  const { sources, unresolvedKey } = useMemo(() => {
    const allKinds = new Set<string>(Object.values(SourceKind));
    const resolvedKinds = kindsKey
      ? kindsKey.split(',').filter((k): k is SourceKind => allKinds.has(k))
      : undefined;
    const resolution = resolveSourcesParam(paramValues, allSources, {
      kinds: resolvedKinds,
      max: MAX_SEARCH_SOURCES,
    });
    if (resolution.status !== 'resolved') {
      return { sources: EMPTY_SOURCES, unresolvedKey: undefined };
    }
    return {
      sources: resolution.sources.length ? resolution.sources : EMPTY_SOURCES,
      unresolvedKey: resolution.unresolved.length
        ? resolution.unresolved.join(', ')
        : undefined,
    };
  }, [paramValues, allSources, kindsKey]);

  useEffect(() => {
    if (unresolvedKey == null) return;
    notifications.show({
      id: 'sources-param-unresolved-' + unresolvedKey,
      color: 'yellow',
      title: 'Some sources were not found',
      message: `No searchable source matches: ${unresolvedKey}. They may have been renamed or deleted.`,
    });
  }, [unresolvedKey]);

  return useMemo(() => ({ sources }), [sources]);
}
