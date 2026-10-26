import type { FilterState } from '@hyperdx/common-utils/dist/filters';

import { promoteWhereToFilters } from '@/components/Explore/promoteWhereToFilters';

function included(filters: FilterState, field: string): string[] {
  return Array.from(filters[field]?.included ?? []).map(String);
}

function excluded(filters: FilterState, field: string): string[] {
  return Array.from(filters[field]?.excluded ?? []).map(String);
}

describe('promoteWhereToFilters', () => {
  it('leaves an in-progress lucene atom in the typed query', () => {
    expect(promoteWhereToFilters('level:error', 'lucene')).toEqual({
      filters: {},
      remainder: 'level:error',
    });
  });

  it('commits a lucene atom after trailing whitespace', () => {
    const result = promoteWhereToFilters('level:error ', 'lucene');
    expect(included(result.filters, 'level')).toEqual(['error']);
    expect(result.remainder).toBe('');
  });

  it('commits on Enter via commitTrailing without requiring a space', () => {
    const result = promoteWhereToFilters('level:error', 'lucene', {
      commitTrailing: true,
    });
    expect(included(result.filters, 'level')).toEqual(['error']);
    expect(result.remainder).toBe('');
  });

  it('peels a completed AND clause while the last token is still being typed', () => {
    const result = promoteWhereToFilters(
      'level:error AND service:ap',
      'lucene',
    );
    expect(included(result.filters, 'level')).toEqual(['error']);
    expect(result.remainder).toBe('service:ap');
  });

  it('does not promote unfielded lucene or wildcards', () => {
    expect(promoteWhereToFilters('timeout ', 'lucene')).toEqual({
      filters: {},
      remainder: 'timeout ',
    });
    expect(promoteWhereToFilters('Body:*timeout* ', 'lucene')).toEqual({
      filters: {},
      remainder: 'Body:*timeout* ',
    });
  });

  it('promotes Slow spans and HTTP 5xx comparisons into a range pill', () => {
    const slow = promoteWhereToFilters('duration:>1s', 'lucene', {
      commitTrailing: true,
    });
    expect(slow.remainder).toBe('');
    expect(slow.filters.duration?.range).toEqual({
      min: 1_000_000_000,
      minOp: '>',
    });

    const slowSql = promoteWhereToFilters('Duration > 1000000000', 'sql', {
      commitTrailing: true,
    });
    expect(slowSql.remainder).toBe('');
    expect(slowSql.filters.Duration?.range).toEqual({
      min: 1_000_000_000,
      minOp: '>',
    });

    const http = promoteWhereToFilters('status:>=500 ', 'lucene');
    expect(http.remainder).toBe('');
    expect(http.filters.status?.range).toEqual({ min: 500, minOp: '>=' });
  });

  it('promotes excluded lucene atoms and quoted values', () => {
    const result = promoteWhereToFilters('-level:info ', 'lucene');
    expect(excluded(result.filters, 'level')).toEqual(['info']);

    const quoted = promoteWhereToFilters('message:"hello world" ', 'lucene');
    expect(included(quoted.filters, 'message')).toEqual(['hello world']);
  });

  it('promotes same-field OR groups and leaves cross-field OR typed', () => {
    const same = promoteWhereToFilters('level:error OR level:warn ', 'lucene');
    expect(included(same.filters, 'level').sort()).toEqual(['error', 'warn']);
    expect(same.remainder).toBe('');

    expect(
      promoteWhereToFilters('level:error OR status:500 ', 'lucene'),
    ).toEqual({
      filters: {},
      remainder: 'level:error OR status:500 ',
    });
  });

  it('commits sql equality atoms and leaves ILIKE typed', () => {
    const result = promoteWhereToFilters("Level = 'error' ", 'sql');
    expect(included(result.filters, 'Level')).toEqual(['error']);
    expect(result.remainder).toBe('');

    expect(promoteWhereToFilters("Body ILIKE '%timeout%' ", 'sql')).toEqual({
      filters: {},
      remainder: "Body ILIKE '%timeout%' ",
    });
  });

  it('keeps leftover unfielded text next to promoted clauses', () => {
    const result = promoteWhereToFilters('level:error AND timeout', 'lucene', {
      commitTrailing: true,
    });
    expect(included(result.filters, 'level')).toEqual(['error']);
    expect(result.remainder).toBe('timeout');
  });
});
