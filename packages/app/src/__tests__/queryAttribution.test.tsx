import { renderHook } from '@testing-library/react';

import {
  QueryAttributionProvider,
  useQueryAttribution,
} from '@/queryAttribution';

describe('QueryAttributionProvider', () => {
  it('returns an empty attribution with no provider', () => {
    const { result } = renderHook(() => useQueryAttribution());
    expect(result.current).toEqual({});
  });

  it('nests, with the inner provider winning on conflict', () => {
    const { result } = renderHook(() => useQueryAttribution(), {
      wrapper: ({ children }) => (
        <QueryAttributionProvider
          attribution={{ surface: 'dashboard', dashboard: 'dash-1' }}
        >
          <QueryAttributionProvider
            attribution={{ surface: 'chart-preview', tile: 'tile-1' }}
          >
            {children}
          </QueryAttributionProvider>
        </QueryAttributionProvider>
      ),
    });

    expect(result.current).toEqual({
      surface: 'chart-preview',
      dashboard: 'dash-1',
      tile: 'tile-1',
    });
  });

  it('keeps the value referentially stable across renders of an inline attribution', () => {
    const { result, rerender } = renderHook(() => useQueryAttribution(), {
      wrapper: ({ children }) => (
        // A new object every render, which is how callers write it.
        <QueryAttributionProvider
          attribution={{ surface: 'search', search: 'search-1' }}
        >
          {children}
        </QueryAttributionProvider>
      ),
    });

    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('produces a new value when the attribution changes', () => {
    let tile = 'tile-1';
    const { result, rerender } = renderHook(() => useQueryAttribution(), {
      wrapper: ({ children }) => (
        <QueryAttributionProvider attribution={{ surface: 'dashboard', tile }}>
          {children}
        </QueryAttributionProvider>
      ),
    });

    const first = result.current;
    tile = 'tile-2';
    rerender();

    expect(result.current).not.toBe(first);
    expect(result.current.tile).toBe('tile-2');
  });
});
