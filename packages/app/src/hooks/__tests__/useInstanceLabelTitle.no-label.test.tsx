import { renderHook } from '@testing-library/react';

jest.mock('@/config', () => ({ INSTANCE_LABEL: '' }));

import { useInstanceLabelTitle } from '@/hooks/useInstanceLabelTitle';

describe('useInstanceLabelTitle (INSTANCE_LABEL unset)', () => {
  it('leaves the title untouched', () => {
    document.title = 'Search - HyperDX';
    renderHook(() => useInstanceLabelTitle());
    expect(document.title).toBe('Search - HyperDX');
  });
});
