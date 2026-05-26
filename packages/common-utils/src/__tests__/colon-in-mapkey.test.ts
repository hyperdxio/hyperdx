import { filtersToQuery, parseLuceneFilter } from '@/filters';
import { parse } from '@/queryParser';

describe('Colon-in-MAP-KEY scenario (LogAttributes with key containing colon)', () => {
  it('parses Lucene when the colon in a field name is properly escaped', () => {
    expect(() =>
      parse(String.raw`LogAttributes.foo\:bar:"value"`),
    ).not.toThrow();
  });

  it('filtersToQuery emits parseable Lucene for bracket-form Map key containing colon', () => {
    const filters = {
      "LogAttributes['foo:bar']": {
        included: new Set<string | boolean>(['value1']),
        excluded: new Set<string | boolean>(),
      },
    };
    const result = filtersToQuery(filters);
    const condition = (result[0] as { condition: string }).condition;
    expect(condition).toBe(String.raw`LogAttributes.foo\:bar:"value1"`);
    expect(() => parse(condition)).not.toThrow();
  });

  it('filtersToQuery emits parseable Lucene for dot-form Map key containing colon', () => {
    const filters = {
      'LogAttributes.foo:bar': {
        included: new Set<string | boolean>(['value1']),
        excluded: new Set<string | boolean>(),
      },
    };
    const result = filtersToQuery(filters);
    const condition = (result[0] as { condition: string }).condition;
    expect(condition).toBe(String.raw`LogAttributes.foo\:bar:"value1"`);
    expect(() => parse(condition)).not.toThrow();
  });

  it('round-trips Map keys containing colons through filtersToQuery + parseLuceneFilter', () => {
    const filters = {
      "LogAttributes['foo:bar']": {
        included: new Set<string | boolean>(['value1']),
        excluded: new Set<string | boolean>(),
      },
    };
    const [emitted] = filtersToQuery(filters);
    const cond = (emitted as { condition: string }).condition;
    const parsed = parseLuceneFilter(cond);
    expect(parsed).toEqual([
      {
        key: 'LogAttributes.foo:bar',
        included: ['value1'],
        excluded: [],
      },
    ]);
  });

  it('round-trips Map keys with colons and excluded values', () => {
    const filters = {
      'LogAttributes.foo:bar': {
        included: new Set<string | boolean>(),
        excluded: new Set<string | boolean>(['unwanted:value']),
      },
    };
    const [emitted] = filtersToQuery(filters);
    const cond = (emitted as { condition: string }).condition;
    expect(cond).toBe(String.raw`-LogAttributes.foo\:bar:"unwanted:value"`);
    expect(parseLuceneFilter(cond)).toEqual([
      {
        key: 'LogAttributes.foo:bar',
        included: [],
        excluded: ['unwanted:value'],
      },
    ]);
  });

  it('round-trips Map keys with multiple colons in the key segment', () => {
    const filters = {
      "LogAttributes['k8s.io:annotation:foo']": {
        included: new Set<string | boolean>(['v1']),
        excluded: new Set<string | boolean>(),
      },
    };
    const [emitted] = filtersToQuery(filters);
    const cond = (emitted as { condition: string }).condition;
    expect(() => parse(cond)).not.toThrow();
    expect(parseLuceneFilter(cond)).toEqual([
      {
        key: 'LogAttributes.k8s.io:annotation:foo',
        included: ['v1'],
        excluded: [],
      },
    ]);
  });

  it('round-trips Map key colon-in-key + colon-in-value simultaneously', () => {
    const filters = {
      "LogAttributes['foo:bar']": {
        included: new Set<string | boolean>(['https://example.com:8080']),
        excluded: new Set<string | boolean>(),
      },
    };
    const [emitted] = filtersToQuery(filters);
    const cond = (emitted as { condition: string }).condition;
    expect(() => parse(cond)).not.toThrow();
    expect(parseLuceneFilter(cond)).toEqual([
      {
        key: 'LogAttributes.foo:bar',
        included: ['https://example.com:8080'],
        excluded: [],
      },
    ]);
  });
});
