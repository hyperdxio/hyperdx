import { renderHook } from '@testing-library/react';

jest.mock('@/config', () => ({ INSTANCE_LABEL: 'UK' }));

import { getTitleSuffix } from '@/hooks/getTitleSuffix';

describe('getTitleSuffix', () => {
  it('returns the suffix for a page to compose into its own title', () => {
    const { result } = renderHook(() => getTitleSuffix());
    expect(result.current).toBe(' UK');
  });
});
