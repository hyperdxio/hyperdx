import { act, renderHook } from '@testing-library/react';

import { useDashboardSectionNav } from '../useDashboardSectionNav';

// Mock nuqs with a per-key state store so `collapsed` and `expanded` are
// independent, mirroring how DBDashboardPage uses these two URL params.
const mockState: Record<string, string[] | null> = {
  collapsed: null,
  expanded: null,
};
const mockSetters: Record<string, jest.Mock> = {};

jest.mock('nuqs', () => ({
  useQueryState: (key: string) => {
    if (!mockSetters[key]) {
      mockSetters[key] = jest.fn(
        (
          updater:
            | string[]
            | null
            | ((prev: string[] | null) => string[] | null),
        ) => {
          mockState[key] =
            typeof updater === 'function' ? updater(mockState[key]) : updater;
        },
      );
    }
    return [mockState[key], mockSetters[key]];
  },
  parseAsArrayOf: () => ({ withOptions: () => ({}) }),
  parseAsString: {},
}));

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

  beforeEach(() => {
    mockState.collapsed = null;
    mockState.expanded = null;
    Object.values(mockSetters).forEach(fn => fn.mockClear());
    mockNotificationsShow.mockClear();
    mockCopyTextToClipboard.mockReset();
  });

  describe('collapseAll', () => {
    it('sets every container id as collapsed and clears the expanded set', () => {
      const { result } = renderHook(() =>
        useDashboardSectionNav({ containers }),
      );
      act(() => {
        result.current.collapseAll();
      });
      expect(mockState.collapsed).toEqual(['a', 'b', 'c']);
      expect(mockState.expanded).toBeNull();
    });

    it('clears both sets when there are no containers', () => {
      const { result } = renderHook(() =>
        useDashboardSectionNav({ containers: [] }),
      );
      act(() => {
        result.current.collapseAll();
      });
      expect(mockState.collapsed).toBeNull();
      expect(mockState.expanded).toBeNull();
    });
  });

  describe('expandAll', () => {
    it('sets every container id as expanded and clears the collapsed set', () => {
      mockState.collapsed = ['a', 'b'];
      const { result } = renderHook(() =>
        useDashboardSectionNav({ containers }),
      );
      act(() => {
        result.current.expandAll();
      });
      expect(mockState.expanded).toEqual(['a', 'b', 'c']);
      expect(mockState.collapsed).toBeNull();
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
      // call without juggling timers.
      const rafSpy = jest
        .spyOn(window, 'requestAnimationFrame')
        .mockImplementation((cb: FrameRequestCallback) => {
          cb(0);
          return 0;
        });

      mockState.collapsed = ['b'];
      const { result } = renderHook(() =>
        useDashboardSectionNav({ containers }),
      );

      act(() => {
        result.current.scrollToContainer('b');
      });

      expect(mockState.expanded).toContain('b');
      expect(mockState.collapsed).toBeNull();
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
        useDashboardSectionNav({ containers }),
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
        useDashboardSectionNav({ containers }),
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
        useDashboardSectionNav({ containers }),
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
