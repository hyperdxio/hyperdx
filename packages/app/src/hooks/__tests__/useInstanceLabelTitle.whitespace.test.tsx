import { renderHook } from '@testing-library/react';

jest.mock('@/config', () => ({ INSTANCE_LABEL: 'AB CDEF ' }));

import { useInstanceLabelTitle } from '@/hooks/useInstanceLabelTitle';

describe('useInstanceLabelTitle (suffix ends in whitespace)', () => {
  it('does not grow the title unboundedly', async () => {
    document.title = 'Search - HyperDX';
    renderHook(() => useInstanceLabelTitle());
    await Promise.resolve();
    await Promise.resolve();
    const lengthAfterFirstFlush = document.title.length;
    await Promise.resolve();
    await Promise.resolve();
    expect(document.title.length).toBe(lengthAfterFirstFlush);
  });
});
