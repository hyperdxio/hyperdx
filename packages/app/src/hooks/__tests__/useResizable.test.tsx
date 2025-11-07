import { fireEvent } from '@testing-library/dom';
import { act, renderHook } from '@testing-library/react';

import useResizable from '../useResizable';

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
      const startEvent = new MouseEvent('mousedown', { clientX: 500 });
      result.current.startResize(startEvent as any);

      // Move mouse to x=600 (right)
      const moveEvent = new MouseEvent('mousemove', { clientX: 600 });
      fireEvent(document, moveEvent);
    });

    // Moving right should decrease width for right panel
    // Delta: 100px = 10% of window width
    expect(result.current.size).toBe(10); // 20 - 10
  });

  it('should handle left resize correctly', () => {
    const { result } = renderHook(() => useResizable(20, 'left'));

    act(() => {
      // Start resize at x=500
      const startEvent = new MouseEvent('mousedown', { clientX: 500 });
      result.current.startResize(startEvent as any);

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
      const startEvent = new MouseEvent('mousedown', { clientX: 500 });
      result.current.startResize(startEvent as any);

      // Try to resize smaller than minimum (10%)
      const moveEvent = new MouseEvent('mousemove', { clientX: 800 });
      fireEvent(document, moveEvent);
    });

    expect(result.current.size).toBe(10); // Should not go below MIN_PANEL_WIDTH_PERCENT
  });

  it('should respect maximum width constraint', () => {
    const { result } = renderHook(() => useResizable(20, 'left'));

    act(() => {
      const startEvent = new MouseEvent('mousedown', { clientX: 500 });
      result.current.startResize(startEvent as any);

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
      const startEvent = new MouseEvent('mousedown', { clientX: 500 });
      result.current.startResize(startEvent as any);
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
        const startEvent = new MouseEvent('mousedown', { clientY: 500 });
        result.current.startResize(startEvent as any);

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
        const startEvent = new MouseEvent('mousedown', { clientY: 500 });
        result.current.startResize(startEvent as any);

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
        const startEvent = new MouseEvent('mousedown', { clientY: 500 });
        result.current.startResize(startEvent as any);

        // Try to resize smaller than minimum (10%)
        const moveEvent = new MouseEvent('mousemove', { clientY: 800 });
        fireEvent(document, moveEvent);
      });

      expect(result.current.size).toBe(50); // Should not go below MIN_PANEL_WIDTH_PERCENT
    });

    it('should respect maximum height constraint (top)', () => {
      const { result } = renderHook(() => useResizable(20, 'top'));

      act(() => {
        const startEvent = new MouseEvent('mousedown', { clientY: 500 });
        result.current.startResize(startEvent as any);

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
