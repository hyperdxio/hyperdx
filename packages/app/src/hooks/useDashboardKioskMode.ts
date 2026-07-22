import { useCallback } from 'react';
import { parseAsBoolean, useQueryState } from 'nuqs';
import { useHotkeys } from '@mantine/hooks';

const kioskParser = parseAsBoolean
  .withDefault(false)
  .withOptions({ history: 'replace' });

export function useDashboardKioskMode() {
  const [isKioskMode, setIsKioskMode] = useQueryState('kiosk', kioskParser);

  const enterKioskMode = useCallback(() => {
    void setIsKioskMode(true);

    if (document.fullscreenElement == null) {
      void document.documentElement.requestFullscreen?.().catch(() => {
        // Fullscreen requires browser support and a user gesture. The
        // URL-backed kiosk layout remains active when it is unavailable.
      });
    }
  }, [setIsKioskMode]);

  const exitKioskMode = useCallback(() => {
    void setIsKioskMode(null);

    if (document.fullscreenElement != null) {
      void document.exitFullscreen?.().catch(() => {
        // Leaving the URL-backed kiosk layout does not depend on the browser
        // fullscreen API succeeding.
      });
    }
  }, [setIsKioskMode]);

  useHotkeys([['Escape', exitKioskMode]]);

  return {
    enterKioskMode,
    exitKioskMode,
    isKioskMode,
  };
}
