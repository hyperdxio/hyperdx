import { renderHook } from '@testing-library/react';

jest.mock('@/config', () => ({ INSTANCE_LABEL: '' }));

import { useTitleSuffix } from '@/hooks/useTitleSuffix';

describe('useTitleSuffix (INSTANCE_LABEL unset)', () => {
  it('returns an empty suffix', () => {
    const { result } = renderHook(() => useTitleSuffix());
    expect(result.current).toBe('');
  });

  it('leaves the title untouched', () => {
    document.title = 'Search - HyperDX';
    renderHook(() => useTitleSuffix());
    expect(document.title).toBe('Search - HyperDX');
  });
});
