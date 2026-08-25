import { SourceKind } from '@hyperdx/common-utils/dist/types';

import {
  getDefaultExploreLanguage,
  getExploreWhereLanguage,
  getFilterExampleQueries,
  setExploreWhereLanguage,
} from '@/components/Explore/queryModeSafety';

describe('queryModeSafety', () => {
  describe('getFilterExampleQueries', () => {
    it('returns lucene and sql clauses for logs and traces', () => {
      const logs = getFilterExampleQueries(SourceKind.Log);
      expect(logs.map(e => e.label)).toEqual(['Error', 'Warning', 'HTTP 5xx']);
      expect(logs.find(e => e.label === 'Error')).toMatchObject({
        lucene: 'level:error',
        sql: "level = 'error'",
        tone: 'danger',
      });
      expect(logs.find(e => e.label === 'Warning')).toMatchObject({
        lucene: 'level:warn',
        sql: "level = 'warn'",
        tone: 'warning',
      });

      const traces = getFilterExampleQueries(SourceKind.Trace);
      expect(traces.map(e => e.label)).toEqual([
        'Error',
        'Warning',
        'Slow spans',
      ]);
      expect(traces.find(e => e.label === 'Slow spans')).toMatchObject({
        lucene: 'duration:>1s',
        sql: 'Duration > 1000000000',
        tone: 'warning',
      });
    });
  });

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
