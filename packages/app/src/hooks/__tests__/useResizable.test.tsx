import { fireEvent } from '@testing-library/dom';
import { act, renderHook } from '@testing-library/react';

import useResizable from '@/hooks/useResizable';

const mouseDownAt = (coords: { clientX?: number; clientY?: number }) => ({
  preventDefault: () => undefined,
  clientX: 0,
  clientY: 0,
  ...coords,
});

describe('useResizable', () => {
  const originalInnerWidth = window.innerWidth;
  const originalOffsetWidth = document.body.offsetWidth;

  beforeEach(() => {
    // Mock window.innerWidth
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1000,
    });

    // Mock document.body.offsetWidth
    Object.defineProperty(document.body, 'offsetWidth', {
      writable: true,
      configurable: true,
      value: 1000,
    });
  });

  afterEach(() => {
    // Restore original values
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    });
    Object.defineProperty(document.body, 'offsetWidth', {
      writable: true,
      configurable: true,
      value: originalOffsetWidth,
    });
  });

  it('should initialize with the provided width', () => {
    const { result } = renderHook(() => useResizable(20));
    expect(result.current.size).toBe(20);
  });

  it('should handle right resize correctly', () => {
    const { result } = renderHook(() => useResizable(20, 'right'));

    act(() => {
      // Start resize at x=500
      result.current.startResize(mouseDownAt({ clientX: 500 }));

      // Move mouse to x=600 (right)
      const moveEvent = new MouseEvent('mousemove', { clientX: 600 });
      fireEvent(document, moveEvent);
    });

    // Moving right should decrease width for right panel
    // Delta: 100px = 10% of window width
    expect(result.current.size).toBe(10); // 20 - 10
  });

  describe('onResizeEnd', () => {
    it('reports the final size once the drag finishes', () => {
      const onResizeEnd = jest.fn();
      const { result } = renderHook(() =>
        useResizable(20, 'right', onResizeEnd),
      );

      act(() => {
        result.current.startResize(mouseDownAt({ clientX: 500 }));
        fireEvent(document, new MouseEvent('mousemove', { clientX: 550 }));
        fireEvent(document, new MouseEvent('mousemove', { clientX: 600 }));
      });

      expect(onResizeEnd).not.toHaveBeenCalled();

      act(() => {
        fireEvent(document, new MouseEvent('mouseup'));
      });

      expect(onResizeEnd).toHaveBeenCalledTimes(1);
      expect(onResizeEnd).toHaveBeenCalledWith(10);
    });

    it('reports a size set directly rather than dragged', () => {
      const onResizeEnd = jest.fn();
      const { result } = renderHook(() =>
        useResizable(20, 'right', onResizeEnd),
      );

      act(() => {
        result.current.setSize(100);
      });
      act(() => {
        result.current.startResize(mouseDownAt({ clientX: 500 }));
        fireEvent(document, new MouseEvent('mouseup'));
      });

      expect(onResizeEnd).toHaveBeenCalledWith(100);
    });
  });

  it('should handle left resize correctly', () => {
    const { result } = renderHook(() => useResizable(20, 'left'));

    act(() => {
      // Start resize at x=500
      result.current.startResize(mouseDownAt({ clientX: 500 }));

      // Move mouse to x=600 (right)
      const moveEvent = new MouseEvent('mousemove', { clientX: 600 });
      fireEvent(document, moveEvent);
    });

    // Moving right should increase width for left panel
    // Delta: 100px = 10% of window width
    expect(result.current.size).toBe(30); // 20 + 10
  });

  it('should respect minimum width constraint', () => {
    const { result } = renderHook(() => useResizable(20, 'right'));

    act(() => {
      result.current.startResize(mouseDownAt({ clientX: 500 }));

      // Try to resize smaller than minimum (10%)
      const moveEvent = new MouseEvent('mousemove', { clientX: 800 });
      fireEvent(document, moveEvent);
    });

    expect(result.current.size).toBe(10); // Should not go below MIN_PANEL_WIDTH_PERCENT
  });

  it('should respect maximum width constraint', () => {
    const { result } = renderHook(() => useResizable(20, 'left'));

    act(() => {
      result.current.startResize(mouseDownAt({ clientX: 500 }));

      // Try to resize larger than maximum
      const moveEvent = new MouseEvent('mousemove', { clientX: 1000 });
      fireEvent(document, moveEvent);
    });

    // Max width should be (1000 - 25) / 1000 * 100 = 97.5%
    expect(result.current.size).toBeLessThanOrEqual(97.5);
  });

  it('should cleanup event listeners on unmount', () => {
    const removeEventListenerSpy = jest.spyOn(document, 'removeEventListener');
    const { result, unmount } = renderHook(() => useResizable(20));

    act(() => {
      // Start resize
      result.current.startResize(mouseDownAt({ clientX: 500 }));
    });

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'mousemove',
      expect.any(Function),
    );
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'mouseup',
      expect.any(Function),
    );
  });

  describe('vertical resizing', () => {
    const originalInnerHeight = window.innerHeight;
    const originalOffsetHeight = document.body.offsetHeight;

    beforeEach(() => {
      Object.defineProperty(window, 'innerHeight', {
        writable: true,
        configurable: true,
        value: 1000,
      });

      Object.defineProperty(document.body, 'offsetHeight', {
        writable: true,
        configurable: true,
        value: 1000,
      });
    });

    afterEach(() => {
      Object.defineProperty(window, 'innerHeight', {
        writable: true,
        configurable: true,
        value: originalInnerHeight,
      });
      Object.defineProperty(document.body, 'offsetHeight', {
        writable: true,
        configurable: true,
        value: originalOffsetHeight,
      });
    });

    it('should handle bottom resize correctly', () => {
      const { result } = renderHook(() => useResizable(20, 'bottom'));

      act(() => {
        result.current.startResize(mouseDownAt({ clientY: 500 }));

        // Move mouse down by 100px
        const moveEvent = new MouseEvent('mousemove', { clientY: 600 });
        fireEvent(document, moveEvent);
      });

      // Moving down should decrease height for bottom panel
      // Delta: 100px = 10% of window height
      expect(result.current.size).toBe(30); // 20 + 10
    });

    it('should handle top resize correctly', () => {
      const { result } = renderHook(() => useResizable(20, 'top'));

      act(() => {
        result.current.startResize(mouseDownAt({ clientY: 500 }));

        // Move mouse down by 100px
        const moveEvent = new MouseEvent('mousemove', { clientY: 600 });
        fireEvent(document, moveEvent);
      });

      // Moving down should increase height for top panel
      // Delta: 100px = 10% of window height
      expect(result.current.size).toBe(10); // 20 - 10
    });

    it('should respect minimum height constraint (bottom)', () => {
      const { result } = renderHook(() => useResizable(20, 'bottom'));

      act(() => {
        result.current.startResize(mouseDownAt({ clientY: 500 }));

        // Try to resize smaller than minimum (10%)
        const moveEvent = new MouseEvent('mousemove', { clientY: 800 });
        fireEvent(document, moveEvent);
      });

      expect(result.current.size).toBe(50); // Should not go below MIN_PANEL_WIDTH_PERCENT
    });

    it('should respect maximum height constraint (top)', () => {
      const { result } = renderHook(() => useResizable(20, 'top'));

      act(() => {
        result.current.startResize(mouseDownAt({ clientY: 500 }));

        // Try to resize larger than maximum
        const moveEvent = new MouseEvent('mousemove', { clientY: 1000 });
        fireEvent(document, moveEvent);
      });

      // Max height should be (1000 - 25) / 1000 * 100 = 97.5%
      expect(result.current.size).toBeLessThanOrEqual(97.5);
    });
  });
});

export {};
