import { renderHook } from '@testing-library/react';

jest.mock('@/config', () => ({ INSTANCE_LABEL: 'UK' }));

import { useInstanceLabelTitle } from '@/hooks/useInstanceLabelTitle';

describe('useInstanceLabelTitle', () => {
  beforeEach(() => {
    document.title = 'Search - HyperDX';
  });

  it('appends the instance label to the current title', () => {
    renderHook(() => useInstanceLabelTitle());
    expect(document.title).toBe('Search - HyperDX UK');
  });

  it('keeps appending the label as the title changes on navigation', async () => {
    renderHook(() => useInstanceLabelTitle());
    document.title = 'Alerts - HyperDX';
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(document.title).toBe('Alerts - HyperDX UK');
  });

  it('does not double-append if the title already has the suffix', () => {
    document.title = 'Search - HyperDX UK';
    renderHook(() => useInstanceLabelTitle());
    expect(document.title).toBe('Search - HyperDX UK');
  });
});
