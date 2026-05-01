import { act, renderHook } from '@testing-library/react';

import { __testing, useOptimizationDismissals } from '../dismissals';

describe('useOptimizationDismissals', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts with no dismissals', () => {
    const { result } = renderHook(() => useOptimizationDismissals());
    expect(result.current.isDismissed('full-text-index', 'source:abc')).toBe(
      false,
    );
    expect(result.current.dismissals).toEqual({});
  });

  it('dismisses, persists, and undismisses by (pluginId, scopeId)', () => {
    const { result } = renderHook(() => useOptimizationDismissals());

    act(() => {
      result.current.dismiss('full-text-index', 'source:abc');
    });

    expect(result.current.isDismissed('full-text-index', 'source:abc')).toBe(
      true,
    );

    // Persisted to localStorage under the documented key
    const raw = window.localStorage.getItem(__testing.STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    const key = __testing.dismissalKey('full-text-index', 'source:abc');
    expect(parsed[key]).toMatchObject({
      pluginId: 'full-text-index',
      scopeId: 'source:abc',
    });

    act(() => {
      result.current.undismiss('full-text-index', 'source:abc');
    });

    expect(result.current.isDismissed('full-text-index', 'source:abc')).toBe(
      false,
    );
  });

  it('keeps dismissals scoped to (pluginId, scopeId)', () => {
    const { result } = renderHook(() => useOptimizationDismissals());

    act(() => {
      result.current.dismiss('full-text-index', 'source:a');
    });

    expect(result.current.isDismissed('full-text-index', 'source:a')).toBe(
      true,
    );
    expect(result.current.isDismissed('full-text-index', 'source:b')).toBe(
      false,
    );
    expect(result.current.isDismissed('other-plugin', 'source:a')).toBe(false);
  });

  it('dismissedScopes groups by pluginId', () => {
    const { result } = renderHook(() => useOptimizationDismissals());

    act(() => {
      result.current.dismiss('full-text-index', 'source:a');
      result.current.dismiss('full-text-index', 'source:b');
      result.current.dismiss('other-plugin', 'source:a');
    });

    const scopes = result.current.dismissedScopes;
    expect(scopes.get('full-text-index')?.size).toBe(2);
    expect(scopes.get('full-text-index')?.has('source:a')).toBe(true);
    expect(scopes.get('full-text-index')?.has('source:b')).toBe(true);
    expect(scopes.get('other-plugin')?.size).toBe(1);
  });

  it('dismissing the same scope twice is idempotent (single record)', () => {
    const { result } = renderHook(() => useOptimizationDismissals());

    act(() => {
      result.current.dismiss('p', 's');
      result.current.dismiss('p', 's');
    });

    expect(Object.keys(result.current.dismissals)).toHaveLength(1);
  });
});
