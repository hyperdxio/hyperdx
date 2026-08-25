import { SourceKind } from '@hyperdx/common-utils/dist/types';

import {
  getDefaultExploreLanguage,
  getExploreWhereLanguage,
  looksLikeSql,
  setExploreWhereLanguage,
  tryConvertLuceneToSqlWhere,
  tryConvertSqlWhereToLucene,
} from '@/components/Explore/queryModeSafety';

describe('queryModeSafety', () => {
  describe('looksLikeSql', () => {
    it('returns false for empty text', () => {
      expect(looksLikeSql('')).toBe(false);
      expect(looksLikeSql('   ')).toBe(false);
    });

    it('returns false for Lucene field:value queries', () => {
      expect(looksLikeSql('level:error')).toBe(false);
      expect(looksLikeSql('level:error AND service:api')).toBe(false);
      expect(looksLikeSql('-status:ok')).toBe(false);
    });

    it('returns true for SQL comparisons', () => {
      expect(looksLikeSql("ServiceName = 'api'")).toBe(true);
      expect(looksLikeSql("col != 'x'")).toBe(true);
      expect(looksLikeSql("col ILIKE '%foo%'")).toBe(true);
      expect(looksLikeSql('col IN (1, 2)')).toBe(true);
    });
  });

  describe('tryConvertSqlWhereToLucene', () => {
    it('converts simple equality and AND/OR/NOT', () => {
      expect(tryConvertSqlWhereToLucene("ServiceName = 'api'")).toBe(
        'ServiceName:api',
      );
      expect(
        tryConvertSqlWhereToLucene("level = 'error' AND status = 500"),
      ).toBe('level:error AND status:500');
      expect(tryConvertSqlWhereToLucene("col != 'x'")).toBe('-col:x');
      expect(
        tryConvertSqlWhereToLucene(
          "ServiceName = 'api' OR ServiceName = 'web'",
        ),
      ).toBe('(ServiceName:api) OR (ServiceName:web)');
    });

    it('quotes values that are not bare tokens', () => {
      expect(tryConvertSqlWhereToLucene("message = 'hello world'")).toBe(
        'message:"hello world"',
      );
    });

    it('returns null for SQL that is not representable as Lucene', () => {
      expect(tryConvertSqlWhereToLucene("col ILIKE '%foo%'")).toBeNull();
      expect(tryConvertSqlWhereToLucene("lower(col) = 'x'")).toBeNull();
      expect(tryConvertSqlWhereToLucene('col IS NULL')).toBeNull();
    });
  });

  describe('tryConvertLuceneToSqlWhere', () => {
    it('converts simple field:value expressions', () => {
      expect(tryConvertLuceneToSqlWhere('level:error')).toBe("level = 'error'");
      expect(tryConvertLuceneToSqlWhere('status:500')).toBe('status = 500');
      expect(tryConvertLuceneToSqlWhere('-col:x')).toBe("col != 'x'");
      expect(tryConvertLuceneToSqlWhere('level:error AND service:api')).toBe(
        "level = 'error' AND service = 'api'",
      );
    });

    it('returns null for Lucene that is not a simple field:value tree', () => {
      expect(tryConvertLuceneToSqlWhere('error')).toBeNull();
      expect(tryConvertLuceneToSqlWhere('duration:>1s')).toBeNull();
      expect(
        tryConvertLuceneToSqlWhere('message:"a phrase" AND error'),
      ).toBeNull();
    });
  });

  describe('explore language preference', () => {
    beforeEach(() => {
      window.localStorage.clear();
    });

    it('defaults to lucene for logs and traces, sql for metrics', () => {
      expect(getDefaultExploreLanguage(SourceKind.Log)).toBe('lucene');
      expect(getDefaultExploreLanguage(SourceKind.Trace)).toBe('lucene');
      expect(getDefaultExploreLanguage(SourceKind.Session)).toBe('lucene');
      expect(getDefaultExploreLanguage(SourceKind.Metric)).toBe('sql');
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
