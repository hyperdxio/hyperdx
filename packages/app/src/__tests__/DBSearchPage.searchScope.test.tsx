import {
  getResultViewState,
  getScopeIndicatorLabel,
  getTraceZeroEmptyDescription,
  resolveSearchScope,
  SEARCH_SCOPE_PARAM,
  SearchConfigSchema,
} from '@/DBSearchPage';

jest.mock('@/layout', () => ({
  withAppNav: (component: any) => component,
}));

describe('SearchConfigSchema searchScope', () => {
  const base = {
    select: '',
    source: 's',
    where: '',
    whereLanguage: 'lucene' as const,
    orderBy: '',
    filters: [],
  };

  it('defaults searchScope to span when absent', () => {
    // @AC-FR003-02
    const parsed = SearchConfigSchema.parse(base);
    expect(parsed.searchScope).toBe('span');
  });

  it('accepts an explicit trace scope', () => {
    // @AC-FR001-01
    const parsed = SearchConfigSchema.parse({ ...base, searchScope: 'trace' });
    expect(parsed.searchScope).toBe('trace');
  });

  it('rejects an unknown scope', () => {
    // @AC-FR003-02
    expect(() =>
      SearchConfigSchema.parse({ ...base, searchScope: 'session' }),
    ).toThrow();
  });
});

describe('resolveSearchScope', () => {
  it('resolves a missing scope (old URL / saved search) to span', () => {
    // @AC-FR003-02
    expect(resolveSearchScope(undefined)).toBe('span');
    expect(resolveSearchScope(null)).toBe('span');
  });

  it('resolves an unknown value to span', () => {
    // @AC-FR003-02
    expect(resolveSearchScope('nonsense')).toBe('span');
  });

  it('preserves an explicit trace scope', () => {
    // @AC-FR001-01
    expect(resolveSearchScope('trace')).toBe('trace');
  });

  it('preserves an explicit span scope', () => {
    expect(resolveSearchScope('span')).toBe('span');
  });
});

describe('SEARCH_SCOPE_PARAM URL round-trip', () => {
  it('serializes trace scope to the URL and parses it back', () => {
    // @AC-FR001-01
    const serialized = SEARCH_SCOPE_PARAM.serialize('trace');
    expect(SEARCH_SCOPE_PARAM.parse(serialized)).toBe('trace');
  });

  it('serializes span scope to the URL and parses it back', () => {
    // @AC-FR001-01
    const serialized = SEARCH_SCOPE_PARAM.serialize('span');
    expect(SEARCH_SCOPE_PARAM.parse(serialized)).toBe('span');
  });

  it('parses an unknown URL value to null (so the schema/default takes over)', () => {
    // @AC-FR003-02
    expect(SEARCH_SCOPE_PARAM.parse('bogus')).toBeNull();
  });
});

describe('getScopeIndicatorLabel', () => {
  it('states the trace scope in text', () => {
    // @AC-FR004-01
    expect(getScopeIndicatorLabel('trace')).toBe('Scope: Trace');
  });

  it('states the span scope in text', () => {
    // @AC-FR004-03
    expect(getScopeIndicatorLabel('span')).toBe('Scope: Span');
  });
});

describe('getResultViewState', () => {
  it('reports error when a query error is present, regardless of row count', () => {
    // @AC-FR004-04
    expect(
      getResultViewState({
        hasQueryError: true,
        isLoading: false,
        rowCount: 0,
        scope: 'trace',
      }),
    ).toBe('error');
    expect(
      getResultViewState({
        hasQueryError: true,
        isLoading: false,
        rowCount: 5,
        scope: 'span',
      }),
    ).toBe('error');
  });

  it('reports the trustworthy trace-zero empty for a trace-scoped zero result', () => {
    // @AC-FR004-02
    expect(
      getResultViewState({
        hasQueryError: false,
        isLoading: false,
        rowCount: 0,
        scope: 'trace',
      }),
    ).toBe('empty-trace');
  });

  it('reports a generic empty for a span-scoped zero result', () => {
    // @AC-FR004-02
    expect(
      getResultViewState({
        hasQueryError: false,
        isLoading: false,
        rowCount: 0,
        scope: 'span',
      }),
    ).toBe('empty');
  });

  it('reports results when rows are present', () => {
    // @AC-FR004-03
    expect(
      getResultViewState({
        hasQueryError: false,
        isLoading: false,
        rowCount: 3,
        scope: 'trace',
      }),
    ).toBe('results');
  });

  it('does not report empty while loading', () => {
    // @AC-FR004-02
    expect(
      getResultViewState({
        hasQueryError: false,
        isLoading: true,
        rowCount: 0,
        scope: 'trace',
      }),
    ).toBe('loading');
  });

  it('never reports a zero-result empty when an error is present at trace scope', () => {
    // @AC-FR004-04
    expect(
      getResultViewState({
        hasQueryError: true,
        isLoading: false,
        rowCount: 0,
        scope: 'trace',
      }),
    ).not.toBe('empty-trace');
  });
});

describe('getTraceZeroEmptyDescription', () => {
  it('labels the empty state with the trace scope so a zero reads as truly-none', () => {
    // @AC-FR004-02
    expect(getTraceZeroEmptyDescription().toLowerCase()).toContain('trace');
  });
});
