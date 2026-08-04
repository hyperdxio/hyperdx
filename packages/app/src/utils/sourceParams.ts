import { SourceKind } from '@hyperdx/common-utils/dist/types';

/**
 * Minimal shape needed to resolve a source param. Structural rather than
 * `TSource` so callers and tests can pass partial fixtures, matching the
 * convention of `getDefaultSourceId` in DBSearchPage.
 */
export type SourceForParamResolution = {
  id: string;
  name: string;
  kind: SourceKind;
  disabled?: boolean;
};

/**
 * Outcome of resolving a source param. Only `resolved` yields a source; the
 * other states tell the caller *why* there isn't one, which is what separates
 * "still loading" (say nothing) from a broken link (warn the user).
 */
export type SourceParamResolution<T extends SourceForParamResolution> =
  /** No param to resolve. */
  | { status: 'empty' }
  /** The source list hasn't loaded, so nothing can be concluded yet. */
  | { status: 'pending' }
  | {
      status: 'resolved';
      source: T;
      /**
       * Set only when more than one equally-good source shares the matched
       * name (IDs are unique, so this can only come from a name).
       */
      ambiguousMatchCount?: number;
    }
  /** The param identifies a real source, but not one of the requested `kinds`. */
  | { status: 'wrong-kind'; source: T }
  /** The param matches no source at all — renamed, deleted, or a typo. */
  | { status: 'not-found' };

/**
 * Resolve a page-level `?source=`-style query param that may hold either a
 * source ID (what the app itself always emits) or a human-written source
 * *name*, so links can be hand-authored: `/search?source=Production%20Logs`.
 *
 * Sources of the wrong `kinds` are never matched — not even by ID. Among the
 * sources with the correct kind, resolve a source as follows:
 *   1. no param / empty            -> `empty`
 *   2. sources not loaded yet      -> `pending`
 *   3. ID match                    -> `resolved`
 *   4. exact-case name match       -> `resolved`
 *   5. case-insensitive name match -> `resolved`
 *   6. no usable match             -> `wrong-kind` when the param does name a
 *      source this page can't show, otherwise `not-found`
 *
 * When more than one source matches by name, prefer enabled sources and then the
 * lowest ID, so the same link always resolves to the same source no matter what
 * order the API returns them in.
 */
export function resolveSourceParam<T extends SourceForParamResolution>(
  paramValue: string | null | undefined,
  sources: T[] | undefined,
  { kinds }: { kinds?: SourceKind[] } = {},
): SourceParamResolution<T> {
  if (paramValue == null || paramValue === '') return { status: 'empty' };
  if (sources == null) return { status: 'pending' };

  const lowercasedParam = paramValue.toLowerCase();
  const sourcesWithValidKind = sources.filter(
    s => !kinds?.length || kinds.includes(s.kind),
  );

  const matchedById = sourcesWithValidKind.find(s => s.id === paramValue);
  if (matchedById) return { status: 'resolved', source: matchedById };

  const exactNameMatches = sourcesWithValidKind.filter(
    s => s.name === paramValue,
  );
  const nameMatches = exactNameMatches.length
    ? exactNameMatches
    : sourcesWithValidKind.filter(
        s => s.name.toLowerCase() === lowercasedParam,
      );

  if (nameMatches.length === 0) {
    // Nothing this page can show matches. Separate "there is no such source"
    // from "it exists but is the wrong kind" so the caller can say which.
    const unusableMatch = sources.find(
      s => s.id === paramValue || s.name.toLowerCase() === lowercasedParam,
    );
    return unusableMatch
      ? { status: 'wrong-kind', source: unusableMatch }
      : { status: 'not-found' };
  }

  // Prefer enabled sources; a disabled one is picked only when it is all there
  // is (a disabled source's ID in the URL has always resolved).
  const enabledMatches = nameMatches.filter(s => !s.disabled);
  const pool = enabledMatches.length ? enabledMatches : nameMatches;
  // Sort by ID so an ambiguous name resolves to the same source on every load.
  const picked = pool.sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )[0];

  return {
    status: 'resolved',
    source: picked,
    ...(pool.length > 1 ? { ambiguousMatchCount: pool.length } : {}),
  };
}
