import { getDefaultExploreLanguage } from '@/components/Explore/queryModeSafety';

describe('getDefaultExploreLanguage', () => {
  it('authors SQL, so the search box and the full query speak one language', () => {
    expect(getDefaultExploreLanguage()).toBe('sql');
  });

  it('ignores any stored preference from when the page had a language switch', () => {
    window.localStorage.setItem('hdx-explore-where-language:log', 'lucene');
    expect(getDefaultExploreLanguage()).toBe('sql');
  });
});
