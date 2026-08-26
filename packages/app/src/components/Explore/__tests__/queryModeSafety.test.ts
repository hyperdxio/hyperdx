import { SourceKind } from '@hyperdx/common-utils/dist/types';

import {
  getDefaultExploreLanguage,
  getExploreWhereLanguage,
  setExploreWhereLanguage,
} from '@/components/Explore/queryModeSafety';

describe('queryModeSafety', () => {
  describe('explore language preference', () => {
    beforeEach(() => {
      window.localStorage.clear();
    });

    it('defaults to lucene for every source kind', () => {
      expect(getDefaultExploreLanguage(SourceKind.Log)).toBe('lucene');
      expect(getDefaultExploreLanguage(SourceKind.Trace)).toBe('lucene');
      expect(getDefaultExploreLanguage(SourceKind.Session)).toBe('lucene');
      expect(getDefaultExploreLanguage(SourceKind.Metric)).toBe('lucene');
      expect(getDefaultExploreLanguage()).toBe('lucene');
    });

    it('remembers the last language per source kind', () => {
      setExploreWhereLanguage(SourceKind.Log, 'sql');
      setExploreWhereLanguage(SourceKind.Metric, 'lucene');
      expect(getExploreWhereLanguage(SourceKind.Log)).toBe('sql');
      expect(getExploreWhereLanguage(SourceKind.Metric)).toBe('lucene');
      expect(getExploreWhereLanguage(SourceKind.Trace)).toBe('lucene');
    });
  });
});
