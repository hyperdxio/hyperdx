import { renderHook } from '@testing-library/react';

import { useRouteChangeState } from '@/hooks/useRouteChangeState';

type Handler = (url: string) => void;

const handlers: Record<string, Handler[]> = {};

const mockRouter = {
  events: {
    on: (event: string, handler: Handler) => {
      (handlers[event] ??= []).push(handler);
    },
    off: (event: string, handler: Handler) => {
      handlers[event] = (handlers[event] ?? []).filter(h => h !== handler);
    },
  },
};

jest.mock('next/router', () => ({
  useRouter: () => mockRouter,
}));

function emit(event: string, url: string) {
  (handlers[event] ?? []).forEach(handler => handler(url));
}

describe('useRouteChangeState', () => {
  beforeEach(() => {
    for (const event of Object.keys(handlers)) delete handlers[event];
    window.history.replaceState({}, '', '/service-map?source=abc');
  });

  it('does not report leaving before any navigation', () => {
    const { result } = renderHook(() => useRouteChangeState());

    expect(result.current.isLeavingPageRef.current).toBe(false);
  });

  it('reports leaving when the destination is another page', () => {
    const { result } = renderHook(() => useRouteChangeState());

    emit('routeChangeStart', '/services?source=abc');

    expect(result.current.isLeavingPageRef.current).toBe(true);
  });

  it('ignores a param update on the same page', () => {
    // nuqs updates params through the Next router, so every param write on the
    // page raises the same event a navigation does.
    const { result } = renderHook(() => useRouteChangeState());

    emit('routeChangeStart', '/service-map?source=def');

    expect(result.current.isLeavingPageRef.current).toBe(false);
  });

  it('ignores the hash', () => {
    const { result } = renderHook(() => useRouteChangeState());

    emit('routeChangeStart', '/service-map#node-1');

    expect(result.current.isLeavingPageRef.current).toBe(false);
  });

  it('stops reporting leaving when the navigation is cancelled', () => {
    const { result } = renderHook(() => useRouteChangeState());

    emit('routeChangeStart', '/services');
    expect(result.current.isLeavingPageRef.current).toBe(true);

    emit('routeChangeError', '/services');
    expect(result.current.isLeavingPageRef.current).toBe(false);
  });

  it('stops reporting leaving once a same-route navigation completes', () => {
    // A dynamic route keeps the same component mounted across paths, so the page
    // has to be allowed to write again after it arrives.
    window.history.replaceState({}, '', '/search/saved-1');
    const { result } = renderHook(() => useRouteChangeState());

    emit('routeChangeStart', '/search/saved-2');
    expect(result.current.isLeavingPageRef.current).toBe(true);

    window.history.replaceState({}, '', '/search/saved-2');
    emit('routeChangeComplete', '/search/saved-2');
    expect(result.current.isLeavingPageRef.current).toBe(false);
  });

  it('detaches its listeners on unmount', () => {
    const { unmount } = renderHook(() => useRouteChangeState());

    unmount();

    expect(handlers['routeChangeStart']).toEqual([]);
    expect(handlers['routeChangeComplete']).toEqual([]);
    expect(handlers['routeChangeError']).toEqual([]);
  });
});
