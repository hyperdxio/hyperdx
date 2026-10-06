import { renderHook } from '@testing-library/react';

jest.mock('@/config', () => ({ INSTANCE_LABEL: '' }));

import { getTitleSuffix } from '@/hooks/getTitleSuffix';

describe('getTitleSuffix (INSTANCE_LABEL unset)', () => {
  it('returns an empty suffix', () => {
    const { result } = renderHook(() => getTitleSuffix());
    expect(result.current).toBe('');
  });
});
