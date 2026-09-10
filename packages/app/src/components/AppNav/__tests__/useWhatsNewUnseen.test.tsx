import { act, renderHook } from '@testing-library/react';

import { useWhatsNewUnseen } from '@/components/AppNav/useWhatsNewUnseen';

const SEEN_KEY = 'hdx-whats-new-seen';

describe('useWhatsNewUnseen', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('nudges on a first-ever visit (nothing acknowledged yet)', () => {
    const { result } = renderHook(() => useWhatsNewUnseen('2.37.0'));
    expect(result.current[0]).toBe(true);
    // Does not write until the user actually opens the menu (markSeen).
    expect(window.localStorage.getItem(SEEN_KEY)).toBeNull();
  });

  it('nudges when a newer release has been published', () => {
    window.localStorage.setItem(SEEN_KEY, '2.36.0');
    const { result } = renderHook(() => useWhatsNewUnseen('2.37.0'));
    expect(result.current[0]).toBe(true);
  });

  it('does not nudge when the acknowledged release is the current one', () => {
    window.localStorage.setItem(SEEN_KEY, '2.37.0');
    const { result } = renderHook(() => useWhatsNewUnseen('2.37.0'));
    expect(result.current[0]).toBe(false);
  });

  // The regression this hook exists to prevent: deployments that stamp a build
  // id into the app version re-sparkled every user on every deploy.
  it('does not nudge across deploys that publish no new release', () => {
    const first = renderHook(() => useWhatsNewUnseen('2.37.0'));
    act(() => first.result.current[1]());
    expect(first.result.current[0]).toBe(false);

    const redeployed = renderHook(() => useWhatsNewUnseen('2.37.0'));
    expect(redeployed.result.current[0]).toBe(false);
  });

  // Strictly newer, not merely different: a rollback must not re-nudge everyone
  // with notes they have already read.
  it('does not nudge after a rollback to an older release', () => {
    window.localStorage.setItem(SEEN_KEY, '2.37.0');
    const { result } = renderHook(() => useWhatsNewUnseen('2.36.0'));
    expect(result.current[0]).toBe(false);
  });

  it('compares numerically, not lexically', () => {
    window.localStorage.setItem(SEEN_KEY, '2.9.0');
    const newer = renderHook(() => useWhatsNewUnseen('2.10.0'));
    expect(newer.result.current[0]).toBe(true);

    window.localStorage.setItem(SEEN_KEY, '2.10.0');
    const older = renderHook(() => useWhatsNewUnseen('2.9.0'));
    expect(older.result.current[0]).toBe(false);
  });

  it('compares patch and minor components, not just major', () => {
    window.localStorage.setItem(SEEN_KEY, '2.37.0');
    const patch = renderHook(() => useWhatsNewUnseen('2.37.1'));
    expect(patch.result.current[0]).toBe(true);
  });

  // Rollout case: browsers carry a build-stamped value written by the old code.
  it('treats a build-stamped value for the same release as already seen', () => {
    window.localStorage.setItem(SEEN_KEY, '2.37.0-sha0724861');
    const same = renderHook(() => useWhatsNewUnseen('2.37.0'));
    expect(same.result.current[0]).toBe(false);

    window.localStorage.setItem(SEEN_KEY, '2.36.0-sha0724861');
    const next = renderHook(() => useWhatsNewUnseen('2.37.0'));
    expect(next.result.current[0]).toBe(true);
  });

  it('markSeen clears the nudge and persists the current release', () => {
    window.localStorage.setItem(SEEN_KEY, '2.36.0');
    const { result } = renderHook(() => useWhatsNewUnseen('2.37.0'));
    expect(result.current[0]).toBe(true);

    act(() => result.current[1]());

    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem(SEEN_KEY)).toBe('2.37.0');
  });

  it('does nothing until a release version is known', () => {
    const { result } = renderHook(() => useWhatsNewUnseen(undefined));
    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem(SEEN_KEY)).toBeNull();
  });
});
