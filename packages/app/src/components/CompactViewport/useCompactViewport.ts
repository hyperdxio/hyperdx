import { useWindowSize } from '@/utils';

/**
 * Viewports below this width use the compact layout. Same cutoff the nav
 * uses to collapse, so a page and the shell switch together.
 */
export const COMPACT_MAX_WIDTH = 900;

export function useCompactViewport() {
  const { width } = useWindowSize();
  // useWindowSize reports nothing until its effect runs. Read the window
  // directly so the first paint matches the viewport. There is no window
  // during SSR, and that stays desktop.
  const measured =
    width ?? (typeof window === 'undefined' ? undefined : window.innerWidth);
  if (measured == null) return false;
  return measured < COMPACT_MAX_WIDTH;
}
