import { useEffect, useMemo } from 'react';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { notifications } from '@mantine/notifications';

import { useSources } from '@/source';
import { resolveSourceParam } from '@/utils/sourceParams';

export type ResolvedSourceParam<T extends TSource = TSource> = {
  source: T | undefined;
};

/**
 * Resolves a page-level source query param that may hold either a source ID
 * (what the app emits) or a source name, and returns the matched source.
 *
 * The hook does not modify the URL. Existing ID-based links are unaffected: IDs
 * are matched before names.
 *
 * Source names which do not match exactly one source are reported via a
 * Mantine warning notification.
 */
export function useResolvedSourceParam<K extends SourceKind>(
  param: string | null | undefined,
  opts: { kinds: K[] },
): ResolvedSourceParam<Extract<TSource, { kind: K }>>;
export function useResolvedSourceParam(
  param: string | null | undefined,
  opts?: { kinds?: SourceKind[] },
): ResolvedSourceParam;

export function useResolvedSourceParam(
  paramValue: string | null | undefined,
  { kinds }: { kinds?: SourceKind[] } = {},
) {
  const { data: sources } = useSources();
  const resolution = resolveSourceParam(paramValue, sources, { kinds });

  const resolvedSource =
    resolution.status === 'resolved' ? resolution.source : undefined;
  const ambiguousMatchCount =
    resolution.status === 'resolved'
      ? resolution.ambiguousMatchCount
      : undefined;
  const ambiguousName =
    ambiguousMatchCount != null ? resolvedSource?.name : undefined;
  const unresolvedParamValue =
    resolution.status === 'not-found' || resolution.status === 'wrong-kind'
      ? paramValue
      : undefined;
  const wrongKindMatch =
    resolution.status === 'wrong-kind' ? resolution.source.kind : undefined;

  // Warn when the param matches more than one source by name, and the first match is being used.
  useEffect(() => {
    if (ambiguousName == null || ambiguousMatchCount == null) return;
    notifications.show({
      id: 'ambiguous-source-name-' + ambiguousName,
      color: 'yellow',
      title: 'Multiple sources share this name',
      message: `${ambiguousMatchCount} sources are named "${ambiguousName}". Using the first match — link with the source ID to be unambiguous.`,
    });
  }, [ambiguousName, ambiguousMatchCount]);

  // Warn when the param doesn't match a source of the requested kind, or any source at all.
  useEffect(() => {
    if (unresolvedParamValue == null) return;
    notifications.show({
      id: 'source-param-unresolved-' + unresolvedParamValue,
      color: 'yellow',
      title: wrongKindMatch ? "Source can't be used here" : 'Source not found',
      message: wrongKindMatch
        ? `"${unresolvedParamValue}" is a ${wrongKindMatch} source, which this page can't show. Pick a source to continue.`
        : `No source matches "${unresolvedParamValue}". It may have been renamed or deleted — pick a source to continue.`,
    });
  }, [unresolvedParamValue, wrongKindMatch]);

  return useMemo(() => ({ source: resolvedSource }), [resolvedSource]);
}
