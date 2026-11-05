import { useCallback, useEffect, useState } from 'react';
import Router from 'next/router';

/**
 * Below the compact breakpoint the sidebar is a 50px icon rail. The toggle
 * opens the full nav over the page instead of changing the saved preference.
 * The overlay closes on navigation, Escape, and a tap on the scrim.
 */
export function useMobileNavOverlay(isCompact: boolean) {
  const [isOpenRequested, setIsOpenRequested] = useState(false);
  const isOpen = isCompact && isOpenRequested;

  // Reset during render, not in an effect. Otherwise an overlay left open
  // would reappear when the window shrinks back to compact.
  const [wasCompact, setWasCompact] = useState(isCompact);
  if (wasCompact !== isCompact) {
    setWasCompact(isCompact);
    if (!isCompact) setIsOpenRequested(false);
  }

  const close = useCallback(() => setIsOpenRequested(false), []);
  const toggle = useCallback(() => setIsOpenRequested(open => !open), []);

  useEffect(() => {
    Router.events.on('routeChangeStart', close);
    return () => Router.events.off('routeChangeStart', close);
  }, [close]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, close]);

  return { isOpen, toggle, close };
}
