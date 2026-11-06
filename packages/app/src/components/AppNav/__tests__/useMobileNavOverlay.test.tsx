import Router from 'next/router';
import { act, renderHook } from '@testing-library/react';

import { useMobileNavOverlay } from '@/components/AppNav/useMobileNavOverlay';

describe('useMobileNavOverlay', () => {
  it('starts closed and opens on toggle when compact', () => {
    const { result } = renderHook(() => useMobileNavOverlay(true));
    expect(result.current.isOpen).toBe(false);

    act(() => result.current.toggle());
    expect(result.current.isOpen).toBe(true);

    act(() => result.current.toggle());
    expect(result.current.isOpen).toBe(false);
  });

  it('never reports open outside the compact viewport', () => {
    const { result } = renderHook(() => useMobileNavOverlay(false));
    act(() => result.current.toggle());
    expect(result.current.isOpen).toBe(false);
  });

  it('closes on Escape', () => {
    const { result } = renderHook(() => useMobileNavOverlay(true));
    act(() => result.current.toggle());

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(result.current.isOpen).toBe(false);
  });

  it('closes when a route change starts', () => {
    const { result } = renderHook(() => useMobileNavOverlay(true));
    act(() => result.current.toggle());

    act(() => {
      Router.events.emit('routeChangeStart', '/chart', { shallow: false });
    });
    expect(result.current.isOpen).toBe(false);
  });

  it('does not reopen after the window grows and shrinks back', () => {
    const { result, rerender } = renderHook(
      ({ isCompact }) => useMobileNavOverlay(isCompact),
      { initialProps: { isCompact: true } },
    );
    act(() => result.current.toggle());

    rerender({ isCompact: false });
    rerender({ isCompact: true });
    expect(result.current.isOpen).toBe(false);
  });

  it('ignores a toggle made while the viewport is wide', () => {
    const { result, rerender } = renderHook(
      ({ isCompact }) => useMobileNavOverlay(isCompact),
      { initialProps: { isCompact: false } },
    );
    act(() => result.current.toggle());

    rerender({ isCompact: true });
    expect(result.current.isOpen).toBe(false);
  });

  it('does not close on Escape pressed inside a text field', () => {
    const { result } = renderHook(() => useMobileNavOverlay(true));
    act(() => result.current.toggle());

    const input = document.createElement('input');
    document.body.appendChild(input);
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(result.current.isOpen).toBe(true);
    input.remove();
  });

  it('locks body scroll while open and restores it on close', () => {
    document.body.style.overflow = 'scroll';
    const { result } = renderHook(() => useMobileNavOverlay(true));

    act(() => result.current.toggle());
    expect(document.body.style.overflow).toBe('hidden');

    act(() => result.current.close());
    expect(document.body.style.overflow).toBe('scroll');
    document.body.style.overflow = '';
  });
});
