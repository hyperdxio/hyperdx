import type { Filter } from '@hyperdx/common-utils/dist/types';

import { buildChartExplorerQuery } from '@/utils/chartExplorerLink';

const sqlFilter = (condition: string): Filter => ({ type: 'sql', condition });

describe('buildChartExplorerQuery', () => {
  describe('without filters', () => {
    it('passes a Lucene WHERE through untouched', () => {
      expect(
        buildChartExplorerQuery({
          where: 'level:error',
          whereLanguage: 'lucene',
        }),
      ).toEqual({ where: 'level:error', whereLanguage: 'lucene' });
    });

    it('passes a SQL WHERE through untouched', () => {
      expect(
        buildChartExplorerQuery({
          where: "ServiceName = 'api'",
          whereLanguage: 'sql',
        }),
      ).toEqual({ where: "ServiceName = 'api'", whereLanguage: 'sql' });
    });

    it('defaults an absent WHERE to an empty Lucene query', () => {
      expect(buildChartExplorerQuery({})).toEqual({
        where: '',
        whereLanguage: 'lucene',
      });
    });

    it('trims surrounding whitespace', () => {
      expect(
        buildChartExplorerQuery({
          where: '  level:error  ',
          whereLanguage: 'lucene',
        }),
      ).toEqual({ where: 'level:error', whereLanguage: 'lucene' });
    });

    it('treats an empty filter list the same as no filters', () => {
      expect(
        buildChartExplorerQuery({
          where: 'level:error',
          whereLanguage: 'lucene',
          filters: [],
        }),
      ).toEqual({ where: 'level:error', whereLanguage: 'lucene' });
    });
  });

  describe('folding filters into WHERE', () => {
    it('uses the lone filter as the WHERE when there is no WHERE', () => {
      expect(
        buildChartExplorerQuery({
          where: '',
          whereLanguage: 'lucene',
          filters: [sqlFilter("ServiceName IN ('api')")],
        }),
      ).toEqual({ where: "ServiceName IN ('api')", whereLanguage: 'sql' });
    });

    it('ANDs multiple filters when there is no WHERE', () => {
      expect(
        buildChartExplorerQuery({
          where: '',
          whereLanguage: 'lucene',
          filters: [
            sqlFilter("ServiceName IN ('api')"),
            sqlFilter("SeverityText IN ('error')"),
          ],
        }),
      ).toEqual({
        where: "(ServiceName IN ('api')) AND (SeverityText IN ('error'))",
        whereLanguage: 'sql',
      });
    });

    it('ANDs filters onto an existing SQL WHERE', () => {
      expect(
        buildChartExplorerQuery({
          where: "Body LIKE '%timeout%'",
          whereLanguage: 'sql',
          filters: [sqlFilter("ServiceName IN ('api')")],
        }),
      ).toEqual({
        where: "(Body LIKE '%timeout%') AND (ServiceName IN ('api'))",
        whereLanguage: 'sql',
      });
    });

    it('parenthesizes so an OR in the WHERE keeps its precedence', () => {
      expect(
        buildChartExplorerQuery({
          where: 'a = 1 OR b = 2',
          whereLanguage: 'sql',
          filters: [sqlFilter("ServiceName IN ('api')")],
        }),
      ).toEqual({
        where: "(a = 1 OR b = 2) AND (ServiceName IN ('api'))",
        whereLanguage: 'sql',
      });
    });

    it('parenthesizes a BETWEEN filter so its inner AND is contained', () => {
      expect(
        buildChartExplorerQuery({
          where: "ServiceName = 'api'",
          whereLanguage: 'sql',
          filters: [sqlFilter('Duration BETWEEN 100 AND 200')],
        }),
      ).toEqual({
        where: "(ServiceName = 'api') AND (Duration BETWEEN 100 AND 200)",
        whereLanguage: 'sql',
      });
    });

    it('renders sql_ast filters as SQL conditions', () => {
      expect(
        buildChartExplorerQuery({
          where: '',
          whereLanguage: 'sql',
          filters: [
            {
              type: 'sql_ast',
              left: 'StatusCode',
              operator: '=',
              right: "'500'",
            },
          ],
        }),
      ).toEqual({ where: "StatusCode = '500'", whereLanguage: 'sql' });
    });

    it('ignores filters that are only whitespace', () => {
      expect(
        buildChartExplorerQuery({
          where: '',
          whereLanguage: 'sql',
          filters: [sqlFilter('   ')],
        }),
      ).toEqual({
        where: '',
        whereLanguage: 'sql',
        filters: [sqlFilter('   ')],
      });
    });
  });

  describe('falling back to config filters', () => {
    it('keeps a Lucene WHERE and passes SQL filters through the config', () => {
      const filters = [sqlFilter("ServiceName IN ('api')")];
      expect(
        buildChartExplorerQuery({
          where: 'level:error',
          whereLanguage: 'lucene',
          filters,
        }),
      ).toEqual({ where: 'level:error', whereLanguage: 'lucene', filters });
    });

    it('passes filters through the config when one has no SQL rendering', () => {
      const filters: Filter[] = [
        sqlFilter("ServiceName IN ('api')"),
        { type: 'lucene', condition: 'level:error' },
      ];
      expect(
        buildChartExplorerQuery({
          where: "Body LIKE '%x%'",
          whereLanguage: 'sql',
          filters,
        }),
      ).toEqual({ where: "Body LIKE '%x%'", whereLanguage: 'sql', filters });
    });
  });
});
