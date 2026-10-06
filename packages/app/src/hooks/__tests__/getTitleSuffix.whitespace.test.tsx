import { renderHook } from '@testing-library/react';

jest.mock('@/config', () => ({ INSTANCE_LABEL: 'EU  West' }));

import { getTitleSuffix } from '@/hooks/getTitleSuffix';

describe('getTitleSuffix (label contains an internal whitespace run)', () => {
  it('collapses the run to a single space', () => {
    const { result } = renderHook(() => getTitleSuffix());
    expect(result.current).toBe(' EU West');
  });
});
