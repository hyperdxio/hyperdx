import { useWindowSize } from '@/utils';

/**
 * Viewports below this width use the compact layout. Same cutoff the nav
 * uses to collapse, so a page and the shell switch together.
 */
export const COMPACT_MAX_WIDTH = 900;

export function useCompactViewport() {
  const { width } = useWindowSize();
  // Width is unknown during SSR and the first client render. AppNav is
  // prerendered, so that first render has to match the server HTML. Treat
  // the unknown width as desktop; the compact layout applies once
  // useWindowSize reports a width.
  if (width == null) return false;
  return width < COMPACT_MAX_WIDTH;
}
