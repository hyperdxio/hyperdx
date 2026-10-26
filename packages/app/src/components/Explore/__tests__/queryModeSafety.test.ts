import {
  getDefaultExploreLanguage,
  hasUneditableLuceneWhere,
  toSqlWhere,
} from '@/components/Explore/queryModeSafety';

describe('getDefaultExploreLanguage', () => {
  it('authors SQL, so the search box and the full query speak one language', () => {
    expect(getDefaultExploreLanguage()).toBe('sql');
  });

  it('ignores any stored preference from when the page had a language switch', () => {
    window.localStorage.setItem('hdx-explore-where-language:log', 'lucene');
    expect(getDefaultExploreLanguage()).toBe('sql');
  });
});

describe('toSqlWhere', () => {
  it('passes a SQL clause through', () => {
    expect(toSqlWhere("ServiceName = 'checkout'", 'sql')).toEqual({
      where: "ServiceName = 'checkout'",
      whereLanguage: 'sql',
    });
  });

  it('names SQL even when the language is missing', () => {
    expect(toSqlWhere('StatusCode = 500', null)).toEqual({
      where: 'StatusCode = 500',
      whereLanguage: 'sql',
    });
  });

  // Keeping the text would run it as SQL and fail in ClickHouse; keeping the
  // language would put the box in a mode Explore has no switch back out of.
  it('drops a Lucene clause rather than relabel it', () => {
    expect(toSqlWhere('service:checkout', 'lucene')).toEqual({
      where: '',
      whereLanguage: 'sql',
    });
  });
});

describe('hasUneditableLuceneWhere', () => {
  it.each([
    ['service:checkout', 'lucene', true],
    ['', 'lucene', false],
    ['   ', 'lucene', false],
    [null, 'lucene', false],
    ['service:checkout', 'sql', false],
    ['service:checkout', null, false],
  ])('%s in %s → %s', (where, language, expected) => {
    expect(hasUneditableLuceneWhere(where, language)).toBe(expected);
  });
});
