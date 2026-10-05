import { renderHook } from '@testing-library/react';

jest.mock('@/config', () => ({ INSTANCE_LABEL: 'UK' }));

import { useTitleSuffix } from '@/hooks/useTitleSuffix';

describe('useTitleSuffix', () => {
  beforeEach(() => {
    document.title = 'Search - HyperDX';
  });

  it('returns the suffix for call sites that render their own title', () => {
    const { result } = renderHook(() => useTitleSuffix());
    expect(result.current).toBe(' UK');
  });

  it('also appends the instance label to the current title', () => {
    renderHook(() => useTitleSuffix());
    expect(document.title).toBe('Search - HyperDX UK');
  });

  it('keeps appending the label as the title changes on navigation', async () => {
    renderHook(() => useTitleSuffix());
    document.title = 'Alerts - HyperDX';
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(document.title).toBe('Alerts - HyperDX UK');
  });

  it('does not double-append if the title already has the suffix', () => {
    document.title = 'Search - HyperDX UK';
    renderHook(() => useTitleSuffix());
    expect(document.title).toBe('Search - HyperDX UK');
  });
});
