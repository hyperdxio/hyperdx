import { act, renderHook } from '@testing-library/react';

import { useAppNavCollapse } from '@/components/AppNav/useAppNavCollapse';
import { COMPACT_MAX_WIDTH } from '@/components/CompactViewport/useCompactViewport';
import { useWindowSize } from '@/utils';

jest.mock('@/utils', () => ({
  useWindowSize: jest.fn(() => ({ width: undefined, height: undefined })),
}));

const useWindowSizeMock = jest.mocked(useWindowSize);

const setWidth = (width: number) =>
  useWindowSizeMock.mockReturnValue({ width, height: 800 });

const storedPreference = () => window.localStorage.getItem('isNavCollapsed');

describe('useAppNavCollapse', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  describe('at or above the compact width', () => {
    beforeEach(() => setWidth(COMPACT_MAX_WIDTH));

    it('starts expanded and never opens over the page', () => {
      const { result } = renderHook(() => useAppNavCollapse('/search'));
      expect(result.current.isCollapsed).toBe(false);
      expect(result.current.isOverlay).toBe(false);
    });

    it('stores the preference when toggled', () => {
      const { result } = renderHook(() => useAppNavCollapse('/search'));
      act(() => result.current.toggle());
      expect(result.current.isCollapsed).toBe(true);
      expect(result.current.isOverlay).toBe(false);
      expect(storedPreference()).toBe('true');

      act(() => result.current.toggle());
      expect(result.current.isCollapsed).toBe(false);
      expect(storedPreference()).toBe('false');
    });

    it('keeps a stored collapsed preference', () => {
      window.localStorage.setItem('isNavCollapsed', 'true');
      const { result } = renderHook(() => useAppNavCollapse('/search'));
      expect(result.current.isCollapsed).toBe(true);
    });
  });

  describe('below the compact width', () => {
    beforeEach(() => setWidth(COMPACT_MAX_WIDTH - 1));

    it('starts as a collapsed rail', () => {
      const { result } = renderHook(() => useAppNavCollapse('/search'));
      expect(result.current.isCollapsed).toBe(true);
      expect(result.current.isOverlay).toBe(false);
    });

    it('opens over the page when toggled, without storing a preference', () => {
      const { result } = renderHook(() => useAppNavCollapse('/search'));
      const before = storedPreference();
      act(() => result.current.toggle());
      expect(result.current.isCollapsed).toBe(false);
      expect(result.current.isOverlay).toBe(true);
      expect(storedPreference()).toBe(before);

      act(() => result.current.toggle());
      expect(result.current.isCollapsed).toBe(true);
      expect(result.current.isOverlay).toBe(false);
      expect(storedPreference()).toBe(before);
    });

    it('closes with closeOverlay', () => {
      const { result } = renderHook(() => useAppNavCollapse('/search'));
      act(() => result.current.toggle());
      act(() => result.current.closeOverlay());
      expect(result.current.isCollapsed).toBe(true);
      expect(result.current.isOverlay).toBe(false);
    });

    it('opens even when the stored preference is collapsed', () => {
      window.localStorage.setItem('isNavCollapsed', 'true');
      const { result } = renderHook(() => useAppNavCollapse('/search'));
      act(() => result.current.toggle());
      expect(result.current.isCollapsed).toBe(false);
      expect(result.current.isOverlay).toBe(true);
      expect(storedPreference()).toBe('true');
    });
  });

  it('closes when the route changes', () => {
    setWidth(COMPACT_MAX_WIDTH - 1);
    const { result, rerender } = renderHook(
      ({ route }) => useAppNavCollapse(route),
      { initialProps: { route: '/search' } },
    );
    act(() => result.current.toggle());
    expect(result.current.isOverlay).toBe(true);

    rerender({ route: '/dashboards/list' });
    expect(result.current.isOverlay).toBe(false);

    // Coming back to the first route does not reopen it.
    rerender({ route: '/search' });
    expect(result.current.isOverlay).toBe(false);
  });

  it('drops the open state when the viewport widens', () => {
    setWidth(COMPACT_MAX_WIDTH - 1);
    const { result, rerender } = renderHook(() => useAppNavCollapse('/search'));
    act(() => result.current.toggle());
    expect(result.current.isOverlay).toBe(true);

    setWidth(COMPACT_MAX_WIDTH);
    rerender();
    expect(result.current.isOverlay).toBe(false);
    expect(result.current.isCollapsed).toBe(false);

    setWidth(COMPACT_MAX_WIDTH - 1);
    rerender();
    expect(result.current.isCollapsed).toBe(true);
    expect(result.current.isOverlay).toBe(false);
  });
});
