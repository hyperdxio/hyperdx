import { filtersToQuery } from '@/filters';

describe('searchFilters', () => {
  describe('filtersToQuery', () => {
    it('should return empty string when no filters', () => {
      const filters = {};
      expect(filtersToQuery(filters)).toEqual([]);
    });

    it('should return query for one filter', () => {
      const filters = {
        a: { included: new Set<string>(['b']), excluded: new Set<string>() },
      };
      expect(filtersToQuery(filters)).toEqual([
        { type: 'sql', condition: "a IN ('b')" },
      ]);
    });

    it('should return query for multiple filters', () => {
      const filters = {
        a: { included: new Set<string>(['b']), excluded: new Set<string>() },
        c: {
          included: new Set<string>(['d', 'x']),
          excluded: new Set<string>(),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        { type: 'sql', condition: "a IN ('b')" },
        { type: 'sql', condition: "c IN ('d', 'x')" },
      ]);
    });

    it('should handle excluded values', () => {
      const filters = {
        a: {
          included: new Set<string>(['b']),
          excluded: new Set<string>(['c']),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        { type: 'sql', condition: "a IN ('b')" },
        { type: 'sql', condition: "a NOT IN ('c')" },
      ]);
    });

    it('should wrap keys with toString() when specified', () => {
      const filters = {
        'json.key': {
          included: new Set<string>(['value']),
          excluded: new Set<string>(['other value']),
        },
      };
      expect(filtersToQuery(filters, { stringifyKeys: true })).toEqual([
        { type: 'sql', condition: "toString(json.key) IN ('value')" },
        { type: 'sql', condition: "toString(json.key) NOT IN ('other value')" },
      ]);
    });

    it('should should handle boolean filter values', () => {
      const filters = {
        isRootSpan: {
          included: new Set<string | boolean>([true]),
          excluded: new Set<string | boolean>([]),
        },
        another_column: {
          included: new Set<string | boolean>([]),
          excluded: new Set<string | boolean>([true, false]),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        { type: 'sql', condition: 'isRootSpan IN (true)' },
        { type: 'sql', condition: 'another_column NOT IN (true, false)' },
      ]);
    });

    it('should escape single quotes in filter values', () => {
      const filters = {
        message: {
          included: new Set<string | boolean>(["my 'filter' key"]),
          excluded: new Set<string | boolean>(),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        {
          type: 'sql',
          condition: "message IN ('my ''filter'' key')",
        },
      ]);
    });

    it('should escape single quotes in excluded filter values', () => {
      const filters = {
        message: {
          included: new Set<string | boolean>(),
          excluded: new Set<string | boolean>(["it's a test"]),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        {
          type: 'sql',
          condition: "message NOT IN ('it''s a test')",
        },
      ]);
    });

    it('should escape single quotes with stringifyKeys', () => {
      const filters = {
        'json.key': {
          included: new Set<string | boolean>(["value with 'quotes'"]),
          excluded: new Set<string | boolean>(),
        },
      };
      expect(filtersToQuery(filters, { stringifyKeys: true })).toEqual([
        {
          type: 'sql',
          condition: "toString(json.key) IN ('value with ''quotes''')",
        },
      ]);
    });
  });
});
