import { getSavedSearchStatus } from '@/components/SavedSearches/savedSearchStatus';

const errors = { type: 'lucene' as const, condition: 'level:error' };
const checkout = { type: 'lucene' as const, condition: 'service:checkout' };

const savedSearch = {
  select: 'Timestamp, Body',
  where: 'level:error',
  whereLanguage: 'lucene',
  source: 'source-1',
  orderBy: 'Timestamp DESC',
  filters: [errors, checkout],
};

describe('getSavedSearchStatus', () => {
  it('is unsaved without a saved search', () => {
    expect(getSavedSearchStatus(undefined, savedSearch)).toBe('unsaved');
  });

  it('is saved when the searched config matches', () => {
    expect(getSavedSearchStatus(savedSearch, { ...savedSearch })).toBe('saved');
  });

  it.each([
    ['select', { select: 'Body' }],
    ['where', { where: 'level:warn' }],
    ['whereLanguage', { whereLanguage: 'sql' }],
    ['source', { source: 'source-2' }],
    ['orderBy', { orderBy: 'Timestamp ASC' }],
    ['filters', { filters: [errors] }],
  ])('is edited when %s changes', (_field, change) => {
    expect(
      getSavedSearchStatus(savedSearch, { ...savedSearch, ...change }),
    ).toBe('edited');
  });

  it('treats empty and missing values as the same', () => {
    expect(
      getSavedSearchStatus(
        { source: 'source-1', where: 'level:error' },
        {
          source: 'source-1',
          where: 'level:error',
          select: '',
          orderBy: null,
          whereLanguage: 'lucene',
          filters: [],
        },
      ),
    ).toBe('saved');
  });

  it('counts reordered filters as an edit', () => {
    expect(
      getSavedSearchStatus(savedSearch, {
        ...savedSearch,
        filters: [checkout, errors],
      }),
    ).toBe('edited');
  });

  it('is saved while the URL has not been populated yet', () => {
    expect(getSavedSearchStatus(savedSearch, {})).toBe('saved');
  });
});
