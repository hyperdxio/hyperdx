import { useCallback, useState } from 'react';
import { useLocalStorage } from '@mantine/hooks';

import { useCompactViewport } from '@/components/CompactViewport/useCompactViewport';

/**
 * Collapse state for the app nav.
 *
 * Wide viewports keep the stored preference. On a compact viewport the nav is
 * a narrow rail, and the expand button opens it over the page. The open state
 * on a compact viewport is not stored, so a phone session does not collapse
 * the nav the next time the same browser opens the app on a desktop.
 *
 * `route` is the current URL. The open nav closes when it changes, so following
 * a link, or going back or forward, closes it.
 */
export function useAppNavCollapse(route: string) {
  const isCompact = useCompactViewport();
  const [isPreferCollapsed, setIsPreferCollapsed] = useLocalStorage<boolean>({
    key: 'isNavCollapsed',
    defaultValue: false,
  });
  // The route the nav was opened on, or null when it is closed.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  if (openedOn != null && (!isCompact || openedOn !== route)) {
    setOpenedOn(null);
  }
  const isCompactOpen = openedOn != null;

  const toggle = useCallback(() => {
    if (isCompact) {
      setOpenedOn(v => (v == null ? route : null));
    } else {
      setIsPreferCollapsed((v: boolean) => !v);
    }
  }, [isCompact, route, setIsPreferCollapsed]);

  const closeOverlay = useCallback(() => setOpenedOn(null), []);

  return {
    isCollapsed: isCompact ? !isCompactOpen : isPreferCollapsed,
    isOverlay: isCompact && isCompactOpen,
    toggle,
    closeOverlay,
  };
}
