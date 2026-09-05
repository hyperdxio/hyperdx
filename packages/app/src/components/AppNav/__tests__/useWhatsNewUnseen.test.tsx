import { act, renderHook } from '@testing-library/react';

import { useWhatsNewUnseen } from '@/components/AppNav/useWhatsNewUnseen';

const SEEN_KEY = 'hdx-whats-new-seen';

describe('useWhatsNewUnseen', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('nudges on a first-ever visit (nothing acknowledged yet)', () => {
    const { result } = renderHook(() => useWhatsNewUnseen('2.31.0'));
    expect(result.current[0]).toBe(true);
    // Does not write until the user actually opens the menu (markSeen).
    expect(window.localStorage.getItem(SEEN_KEY)).toBeNull();
  });

  it('nudges when the stored version differs from the current one', () => {
    window.localStorage.setItem(SEEN_KEY, '2.30.0');
    const { result } = renderHook(() => useWhatsNewUnseen('2.31.0'));
    expect(result.current[0]).toBe(true);
  });

  it('does not nudge when the stored version matches', () => {
    window.localStorage.setItem(SEEN_KEY, '2.31.0');
    const { result } = renderHook(() => useWhatsNewUnseen('2.31.0'));
    expect(result.current[0]).toBe(false);
  });

  it('markSeen clears the nudge and persists the current version', () => {
    window.localStorage.setItem(SEEN_KEY, '2.30.0');
    const { result } = renderHook(() => useWhatsNewUnseen('2.31.0'));
    expect(result.current[0]).toBe(true);

    act(() => result.current[1]());

    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem(SEEN_KEY)).toBe('2.31.0');
  });

  it('does nothing until a version is known', () => {
    const { result } = renderHook(() => useWhatsNewUnseen(undefined));
    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem(SEEN_KEY)).toBeNull();
  });
});
