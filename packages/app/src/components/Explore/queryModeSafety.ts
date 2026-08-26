import { SourceKind } from '@hyperdx/common-utils/dist/types';

const EXPLORE_LANGUAGE_KEY_PREFIX = 'hdx-explore-where-language:';

export type QueryLanguage = 'sql' | 'lucene';

export function getDefaultExploreLanguage(_kind?: SourceKind): QueryLanguage {
  return 'lucene';
}

export function getExploreWhereLanguage(kind?: SourceKind): QueryLanguage {
  if (typeof window !== 'undefined' && kind != null) {
    try {
      const stored = window.localStorage.getItem(
        `${EXPLORE_LANGUAGE_KEY_PREFIX}${kind}`,
      );
      if (stored === 'sql' || stored === 'lucene') {
        return stored;
      }
    } catch {
      // localStorage may throw in private browsing
    }
  }
  return getDefaultExploreLanguage(kind);
}

export function setExploreWhereLanguage(
  kind: SourceKind | undefined,
  language: QueryLanguage,
): void {
  if (typeof window === 'undefined' || kind == null) {
    return;
  }
  try {
    window.localStorage.setItem(
      `${EXPLORE_LANGUAGE_KEY_PREFIX}${kind}`,
      language,
    );
  } catch {
    // localStorage may throw in private browsing
  }
}
