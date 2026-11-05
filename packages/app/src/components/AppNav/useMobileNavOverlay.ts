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
  const toggle = useCallback(() => {
    // A click while the viewport is wide must not stick, or the overlay
    // would appear the next time the window shrinks.
    if (!isCompact) return;
    setIsOpenRequested(open => !open);
  }, [isCompact]);

  useEffect(() => {
    Router.events.on('routeChangeStart', close);
    return () => Router.events.off('routeChangeStart', close);
  }, [close]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    // The scrim covers the page but does not catch wheel or touch scrolling.
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldCloseOnEscape(event)) close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, close]);

  return { isOpen, toggle, close };
}

// Escape also dismisses a menu, modal, or field opened from the nav. Those
// handlers run first and either stop the event or leave focus inside their
// own popup, so this overlay must not close on the same keypress.
function shouldCloseOnEscape(event: KeyboardEvent): boolean {
  if (event.key !== 'Escape' || event.defaultPrevented) return false;
  const target = event.target;
  if (!(target instanceof Element)) return true;
  if (
    (target instanceof HTMLElement && target.isContentEditable) ||
    target.closest(
      'input, textarea, select, [role="dialog"], [role="menu"], [role="listbox"]',
    )
  ) {
    return false;
  }
  return true;
}
