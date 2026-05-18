import { filtersToQuery, parseLuceneFilter } from '@/filters';

describe('filters', () => {
  describe('filtersToQuery', () => {
    it('should return empty array when no filters', () => {
      expect(filtersToQuery({})).toEqual([]);
    });

    it('should emit lucene for a single included value', () => {
      const filters = {
        a: { included: new Set<string>(['b']), excluded: new Set<string>() },
      };
      expect(filtersToQuery(filters)).toEqual([
        { type: 'lucene', condition: 'a:"b"' },
      ]);
    });

    it('should emit lucene with parens for multiple included values', () => {
      const filters = {
        c: {
          included: new Set<string>(['d', 'x']),
          excluded: new Set<string>(),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        { type: 'lucene', condition: '(c:"d" OR c:"x")' },
      ]);
    });

    it('should handle excluded values without parens', () => {
      const filters = {
        a: {
          included: new Set<string>(['b']),
          excluded: new Set<string>(['c']),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        { type: 'lucene', condition: 'a:"b"' },
        { type: 'lucene', condition: '-a:"c"' },
      ]);
    });

    it('should handle multiple excluded values without parens', () => {
      const filters = {
        a: {
          included: new Set<string | boolean>(),
          excluded: new Set<string | boolean>([true, false]),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        {
          type: 'lucene',
          condition: '-a:"true" AND -a:"false"',
        },
      ]);
    });

    it('should handle boolean filter values', () => {
      const filters = {
        isRootSpan: {
          included: new Set<string | boolean>([true]),
          excluded: new Set<string | boolean>([]),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        { type: 'lucene', condition: 'isRootSpan:"true"' },
      ]);
    });

    it('should escape double quotes in values', () => {
      const filters = {
        message: {
          included: new Set<string | boolean>(['say "hello"']),
          excluded: new Set<string | boolean>(),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        { type: 'lucene', condition: 'message:"say \\"hello\\""' },
      ]);
    });

    it('should pass through single quotes in values', () => {
      const filters = {
        message: {
          included: new Set<string | boolean>(["it's a test"]),
          excluded: new Set<string | boolean>(),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        { type: 'lucene', condition: 'message:"it\'s a test"' },
      ]);
    });

    it('should escape backslashes in values', () => {
      const filters = {
        FilePath: {
          included: new Set<string | boolean>(['C:\\path\\to\\file']),
          excluded: new Set<string | boolean>(),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        {
          type: 'lucene',
          condition: 'FilePath:"C:\\\\path\\\\to\\\\file"',
        },
      ]);
    });

    it('should convert Map bracket-notation keys to dot notation', () => {
      const filters = {
        "LogAttributes['service.name']": {
          included: new Set<string | boolean>(['my-app']),
          excluded: new Set<string | boolean>(),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        {
          type: 'lucene',
          condition: 'LogAttributes.service.name:"my-app"',
        },
      ]);
    });

    it('should handle Map bracket-notation with multiple values', () => {
      const filters = {
        "LogAttributes['env']": {
          included: new Set<string | boolean>(['prod', 'staging']),
          excluded: new Set<string | boolean>(),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        {
          type: 'lucene',
          condition:
            '(LogAttributes.env:"prod" OR LogAttributes.env:"staging")',
        },
      ]);
    });

    it('should handle Map bracket-notation excluded values', () => {
      const filters = {
        "LogAttributes['level']": {
          included: new Set<string | boolean>(),
          excluded: new Set<string | boolean>(['debug']),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        { type: 'lucene', condition: '-LogAttributes.level:"debug"' },
      ]);
    });

    it('should handle Map bracket-notation with both included and excluded', () => {
      const filters = {
        "ResourceAttributes['host']": {
          included: new Set<string | boolean>(['web-1']),
          excluded: new Set<string | boolean>(['web-2']),
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        { type: 'lucene', condition: 'ResourceAttributes.host:"web-1"' },
        { type: 'lucene', condition: '-ResourceAttributes.host:"web-2"' },
      ]);
    });

    it('should keep range as sql', () => {
      const filters = {
        duration: {
          included: new Set<string | boolean>(),
          excluded: new Set<string | boolean>(),
          range: { min: 10, max: 500 },
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        { type: 'sql', condition: 'duration BETWEEN 10 AND 500' },
      ]);
    });

    it('should keep range as sql for Map bracket-notation keys', () => {
      const filters = {
        "LogAttributes['latency']": {
          included: new Set<string | boolean>(),
          excluded: new Set<string | boolean>(),
          range: { min: 0, max: 100 },
        },
      };
      expect(filtersToQuery(filters)).toEqual([
        {
          type: 'sql',
          condition: "LogAttributes['latency'] BETWEEN 0 AND 100",
        },
      ]);
    });
  });

  describe('parseLuceneFilter', () => {
    it('should return undefined for empty string', () => {
      expect(parseLuceneFilter('')).toBeUndefined();
    });

    it('should return undefined for unquoted terms', () => {
      expect(parseLuceneFilter('service:foo')).toBeUndefined();
    });

    it('should parse a single included term', () => {
      expect(parseLuceneFilter('service:"app"')).toEqual([
        { key: 'service', included: ['app'], excluded: [] },
      ]);
    });

    it('should parse a single excluded term', () => {
      expect(parseLuceneFilter('-service:"app"')).toEqual([
        { key: 'service', included: [], excluded: ['app'] },
      ]);
    });

    it('should parse multiple included values with OR', () => {
      expect(parseLuceneFilter('(service:"app" OR service:"web")')).toEqual([
        { key: 'service', included: ['app', 'web'], excluded: [] },
      ]);
    });

    it('should parse multiple excluded values with AND', () => {
      expect(
        parseLuceneFilter('-service:"debug" AND -service:"trace"'),
      ).toEqual([
        { key: 'service', included: [], excluded: ['debug', 'trace'] },
      ]);
    });

    it('should parse mixed included and excluded for the same field', () => {
      expect(
        parseLuceneFilter('-service:"bingo" (service:"foo" OR service:"bar")'),
      ).toEqual([
        { key: 'service', included: ['foo', 'bar'], excluded: ['bingo'] },
      ]);
    });

    it('should parse multiple distinct fields', () => {
      expect(parseLuceneFilter('service:"app" level:"info"')).toEqual([
        { key: 'service', included: ['app'], excluded: [] },
        { key: 'level', included: ['info'], excluded: [] },
      ]);
    });

    it('should parse multiple fields with mixed negation', () => {
      expect(
        parseLuceneFilter('service:"app" -level:"debug" level:"info"'),
      ).toEqual([
        { key: 'service', included: ['app'], excluded: [] },
        { key: 'level', included: ['info'], excluded: ['debug'] },
      ]);
    });

    it('should parse dot-notation fields (Map columns)', () => {
      expect(parseLuceneFilter('LogAttributes.env:"prod"')).toEqual([
        { key: 'LogAttributes.env', included: ['prod'], excluded: [] },
      ]);
    });

    it('should handle values with escaped double quotes', () => {
      expect(parseLuceneFilter('message:"say \\"hello\\""')).toEqual([
        { key: 'message', included: ['say "hello"'], excluded: [] },
      ]);
    });

    it('should handle values with backslashes', () => {
      expect(parseLuceneFilter('path:"C:\\\\dir\\\\file"')).toEqual([
        { key: 'path', included: ['C:\\dir\\file'], excluded: [] },
      ]);
    });

    it('should return undefined for invalid lucene syntax', () => {
      expect(parseLuceneFilter('((((')).toBeUndefined();
    });
  });
});
