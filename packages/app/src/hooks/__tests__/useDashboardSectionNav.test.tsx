import { act, renderHook } from '@testing-library/react';

import { useDashboardSectionNav } from '../useDashboardSectionNav';

// Stand-in for the URL setter the hook receives from its caller. Stores the
// current value and supports both absolute writes and functional updates so
// the hook's `produce(prev ?? [], ...)` and `(prev ?? []).filter(...)` paths
// can be observed.
function makeMockSetter() {
  let current: string[] | null = null;
  const setter = jest.fn(
    (
      updater: string[] | null | ((prev: string[] | null) => string[] | null),
    ) => {
      current = typeof updater === 'function' ? updater(current) : updater;
    },
  );
  return Object.assign(setter, {
    get: () => current,
    reset: () => {
      current = null;
      setter.mockClear();
    },
  });
}

const mockNotificationsShow = jest.fn();
jest.mock('@mantine/notifications', () => ({
  notifications: {
    show: (...args: unknown[]) => mockNotificationsShow(...args),
  },
}));

const mockCopyTextToClipboard = jest.fn();
jest.mock('@/utils/clipboard', () => ({
  CLIPBOARD_ERROR_MESSAGE: 'mock clipboard error',
  copyTextToClipboard: (text: string) => mockCopyTextToClipboard(text),
}));

describe('useDashboardSectionNav', () => {
  const containers = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  let setUrlCollapsedIds: ReturnType<typeof makeMockSetter>;
  let setUrlExpandedIds: ReturnType<typeof makeMockSetter>;

  beforeEach(() => {
    setUrlCollapsedIds = makeMockSetter();
    setUrlExpandedIds = makeMockSetter();
    mockNotificationsShow.mockClear();
    mockCopyTextToClipboard.mockReset();
  });

  describe('collapseAll', () => {
    it('sets every container id as collapsed and clears the expanded set', () => {
      const { result } = renderHook(() =>
        useDashboardSectionNav({
          containers,
          setUrlCollapsedIds,
          setUrlExpandedIds,
        }),
      );
      act(() => {
        result.current.collapseAll();
      });
      expect(setUrlCollapsedIds.get()).toEqual(['a', 'b', 'c']);
      expect(setUrlExpandedIds.get()).toBeNull();
    });

    it('clears both sets when there are no containers', () => {
      const { result } = renderHook(() =>
        useDashboardSectionNav({
          containers: [],
          setUrlCollapsedIds,
          setUrlExpandedIds,
        }),
      );
      act(() => {
        result.current.collapseAll();
      });
      expect(setUrlCollapsedIds.get()).toBeNull();
      expect(setUrlExpandedIds.get()).toBeNull();
    });
  });

  describe('expandAll', () => {
    it('sets every container id as expanded and clears the collapsed set', () => {
      setUrlCollapsedIds(['a', 'b']);
      setUrlCollapsedIds.mockClear();
      const { result } = renderHook(() =>
        useDashboardSectionNav({
          containers,
          setUrlCollapsedIds,
          setUrlExpandedIds,
        }),
      );
      act(() => {
        result.current.expandAll();
      });
      expect(setUrlExpandedIds.get()).toEqual(['a', 'b', 'c']);
      expect(setUrlCollapsedIds.get()).toBeNull();
    });
  });

  describe('scrollToContainer', () => {
    it('expands the target container and scrolls its DOM node into view', () => {
      const scrollIntoView = jest.fn();
      const target = document.createElement('div');
      target.id = 'container-b';
      // Overwrite the native method with a spy. The native signature accepts
      // boolean | ScrollIntoViewOptions; our hook only ever passes options.
      Object.assign(target, { scrollIntoView });
      document.body.appendChild(target);

      // Drive requestAnimationFrame synchronously so we can assert the scroll
      // call without juggling timers. The hook uses double-rAF, so the mock
      // is invoked twice.
      const rafSpy = jest
        .spyOn(window, 'requestAnimationFrame')
        .mockImplementation((cb: FrameRequestCallback) => {
          cb(0);
          return 0;
        });

      setUrlCollapsedIds(['b']);
      setUrlCollapsedIds.mockClear();
      const { result } = renderHook(() =>
        useDashboardSectionNav({
          containers,
          setUrlCollapsedIds,
          setUrlExpandedIds,
        }),
      );

      act(() => {
        result.current.scrollToContainer('b');
      });

      expect(setUrlExpandedIds.get()).toContain('b');
      expect(setUrlCollapsedIds.get()).toBeNull();
      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'start',
      });

      rafSpy.mockRestore();
      document.body.removeChild(target);
    });

    it('does not throw when the target node is missing', () => {
      const rafSpy = jest
        .spyOn(window, 'requestAnimationFrame')
        .mockImplementation((cb: FrameRequestCallback) => {
          cb(0);
          return 0;
        });

      const { result } = renderHook(() =>
        useDashboardSectionNav({
          containers,
          setUrlCollapsedIds,
          setUrlExpandedIds,
        }),
      );
      expect(() => {
        act(() => {
          result.current.scrollToContainer('does-not-exist');
        });
      }).not.toThrow();

      rafSpy.mockRestore();
    });
  });

  describe('copySectionLink', () => {
    const originalUrl =
      typeof window !== 'undefined' ? window.location.href : '';

    beforeEach(() => {
      // jsdom forbids reassigning `window.location`, but `history.replaceState`
      // legitimately updates pathname/search via the platform — exactly what
      // copySectionLink reads from window.location.
      window.history.replaceState({}, '', '/dashboards/d-1?from=test');
    });

    afterEach(() => {
      window.history.replaceState({}, '', originalUrl || '/');
    });

    it('delegates to copyTextToClipboard with the deep link and confirms via notification', async () => {
      mockCopyTextToClipboard.mockResolvedValue(true);

      const { result } = renderHook(() =>
        useDashboardSectionNav({
          containers,
          setUrlCollapsedIds,
          setUrlExpandedIds,
        }),
      );

      await act(async () => {
        await result.current.copySectionLink('b');
      });

      expect(mockCopyTextToClipboard).toHaveBeenCalledWith(
        `${window.location.origin}/dashboards/d-1?from=test#container-b`,
      );
      expect(mockNotificationsShow).toHaveBeenCalledWith(
        expect.objectContaining({ color: 'green', title: 'Link copied' }),
      );
    });

    it('surfaces a failure notification when copyTextToClipboard returns false', async () => {
      mockCopyTextToClipboard.mockResolvedValue(false);

      const { result } = renderHook(() =>
        useDashboardSectionNav({
          containers,
          setUrlCollapsedIds,
          setUrlExpandedIds,
        }),
      );

      await act(async () => {
        await result.current.copySectionLink('b');
      });

      expect(mockNotificationsShow).toHaveBeenCalledWith(
        expect.objectContaining({ color: 'red' }),
      );
    });
  });
});
