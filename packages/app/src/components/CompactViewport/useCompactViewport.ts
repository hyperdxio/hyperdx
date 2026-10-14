import { useWindowSize } from '@/utils';

/**
 * Viewports below this width use the compact layout. Same cutoff the nav
 * uses to collapse, so a page and the shell switch together.
 */
export const COMPACT_MAX_WIDTH = 900;

export function useCompactViewport() {
  const { width } = useWindowSize();
  // Width is unknown during SSR and the first paint. Treat that as desktop
  // so the compact layout does not flash in before the viewport is measured.
  if (width == null) return false;
  return width < COMPACT_MAX_WIDTH;
}
