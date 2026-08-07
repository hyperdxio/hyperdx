import { renderHook } from '@testing-library/react';

import { useIsVariablesEnabled } from '@/hooks/useIsVariablesEnabled';

let variablesEnabled = true;

jest.mock('@/config', () => ({
  ...jest.requireActual('@/config'),
  get IS_DASHBOARD_VARIABLES_ENABLED() {
    return variablesEnabled;
  },
}));

describe('useIsVariablesEnabled', () => {
  it('reports the feature as enabled when the flag is on', () => {
    variablesEnabled = true;

    const { result } = renderHook(() => useIsVariablesEnabled());

    expect(result.current).toEqual({
      isLoading: false,
      isVariablesEnabled: true,
    });
  });

  it('reports the feature as disabled when the flag is off', () => {
    variablesEnabled = false;

    const { result } = renderHook(() => useIsVariablesEnabled());

    expect(result.current).toEqual({
      isLoading: false,
      isVariablesEnabled: false,
    });
  });

  // Callers put the returned object in dependency arrays, so a fresh literal per
  // render would churn them once this becomes a network-loaded setting.
  it('returns a referentially stable object across re-renders', () => {
    variablesEnabled = true;

    const { result, rerender } = renderHook(() => useIsVariablesEnabled());
    const first = result.current;
    rerender();

    expect(result.current).toBe(first);
  });
});
