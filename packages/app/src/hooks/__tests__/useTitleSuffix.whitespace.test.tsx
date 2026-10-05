import { renderHook } from '@testing-library/react';

// A double space is a value real config.ts can produce before its own
// collapsing, and is also what document.title would collapse on write -
// this is the case that actually breaks the endsWith-based dedup check,
// not a trailing space (which .trim() already handles upstream).
jest.mock('@/config', () => ({ INSTANCE_LABEL: 'EU  West' }));

import { useTitleSuffix } from '@/hooks/useTitleSuffix';

describe('useTitleSuffix (label contains an internal whitespace run)', () => {
  it('collapses the run so the suffix matches what document.title will store', () => {
    document.title = 'Search - HyperDX';
    const { result } = renderHook(() => useTitleSuffix());
    expect(result.current).toBe(' EU West');
    expect(document.title).toBe('Search - HyperDX EU West');
  });

  it('does not double-append when the title already has the collapsed suffix', () => {
    document.title = 'Search - HyperDX EU West';
    renderHook(() => useTitleSuffix());
    expect(document.title).toBe('Search - HyperDX EU West');
  });
});
