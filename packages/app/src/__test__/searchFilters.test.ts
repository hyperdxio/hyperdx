import { filtersToQuery, parseQuery } from '../searchFilters';

describe('searchFilters', () => {
  describe('filtersToQuery', () => {
    it('should return empty string when no filters', () => {
      const filters = {};
      expect(filtersToQuery(filters)).toBe('');
    });

    it('should return query for one filter', () => {
      const filters = { a: new Set(['b']) };
      expect(filtersToQuery(filters)).toBe('((a:"b"))');
    });

    it('should return query for multiple filters', () => {
      const filters = { a: new Set(['b']), c: new Set(['d']) };
      expect(filtersToQuery(filters)).toBe('((a:"b") AND (c:"d"))');
    });
  });

  describe('parseQuery', () => {
    it('empty query', () => {
      const result = parseQuery('');
      expect(result.filters).toEqual({});
      expect(result.userQuery).toEqual('');
    });

    it('user query only', () => {
      const result = parseQuery('foo');
      expect(result.filters).toEqual({});
      expect(result.userQuery).toEqual('foo');
    });

    it('user query only, complex', () => {
      const q = '(foo AND service:"bar") OR baz';
      const result = parseQuery(q);
      expect(result.filters).toEqual({});
      expect(result.userQuery).toEqual(q);
    });

    it('parses one filter', () => {
      const result = parseQuery('((service:"z"))');
      expect(result.filters).toEqual({ service: new Set(['z']) });
      expect(result.userQuery).toEqual('');
    });

    it('parses one filter with user query, left', () => {
      const result = parseQuery('user query here ((service:"z"))');
      expect(result.filters).toEqual({ service: new Set(['z']) });
      expect(result.userQuery).toEqual('user query here');
    });

    it('parses one filter with user query, right', () => {
      const result = parseQuery('((service:"z")) user query here');
      expect(result.filters).toEqual({ service: new Set(['z']) });
      expect(result.userQuery).toEqual('user query here');
    });

    it('parses 1 group, multiple values', () => {
      const result = parseQuery(
        '((service:"z" OR service:"y" OR service:"x"))',
      );
      expect(result.filters).toEqual({ service: new Set(['z', 'y', 'x']) });
      expect(result.userQuery).toEqual('');
    });

    it('parses 3 groups, multiple values', () => {
      const result = parseQuery(
        '((service:"z" OR service:"y" OR service:"x") AND (level:"info" OR level:"error") AND (type:"event"))',
      );
      expect(result.filters).toEqual({
        service: new Set(['z', 'y', 'x']),
        level: new Set(['info', 'error']),
        type: new Set(['event']),
      });
      expect(result.userQuery).toEqual('');
    });

    it('throws when filter query is invalid', () => {
      try {
        parseQuery(
          '((service:"z" OR level:"y" OR service:"x") AND (level:"info" OR level:"error") AND (type:"event"))',
        );
        expect(false).toBe(true); // should not reach here
      } catch (e) {
        expect(e.message).not.toBeNull();
      }
    });
  });
});
