jest.mock('next-runtime-env', () => ({
  env: (key: string) =>
    key === 'NEXT_PUBLIC_INSTANCE_LABEL' ? 'UK' : undefined,
}));

import { renderHook } from '@testing-library/react';

import { usePageTitle } from '@/brand';

describe('usePageTitle', () => {
  it('is the brand name plus the instance label when no page is given', () => {
    const { result } = renderHook(() => usePageTitle());
    expect(result.current).toBe('ClickStack UK');
  });

  it('prepends the page name', () => {
    const { result } = renderHook(() => usePageTitle('Search'));
    expect(result.current).toBe('Search - ClickStack UK');
  });
});
