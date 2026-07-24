import { useCallback, useEffect, useRef } from 'react';
import { parseAsBoolean, useQueryState } from 'nuqs';
import { useHotkeys } from '@mantine/hooks';

const kioskParser = parseAsBoolean
  .withDefault(false)
  .withOptions({ history: 'replace' });

export function useDashboardKioskMode() {
  const [isKioskMode, setIsKioskMode] = useQueryState('kiosk', kioskParser);
  const ownsNativeFullscreenRef = useRef(false);

  const enterKioskMode = useCallback(() => {
    void setIsKioskMode(true);

    const requestFullscreen = document.documentElement.requestFullscreen;
    if (document.fullscreenElement == null && requestFullscreen) {
      ownsNativeFullscreenRef.current = true;
      void requestFullscreen.call(document.documentElement).catch(() => {
        ownsNativeFullscreenRef.current = false;
        // Fullscreen requires browser support and a user gesture. The
        // URL-backed kiosk layout remains active when it is unavailable.
      });
    }
  }, [setIsKioskMode]);

  const exitKioskMode = useCallback(() => {
    ownsNativeFullscreenRef.current = false;
    void setIsKioskMode(null);

    if (document.fullscreenElement != null) {
      void document.exitFullscreen?.().catch(() => {
        // Leaving the URL-backed kiosk layout does not depend on the browser
        // fullscreen API succeeding.
      });
    }
  }, [setIsKioskMode]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (
        document.fullscreenElement == null &&
        ownsNativeFullscreenRef.current
      ) {
        ownsNativeFullscreenRef.current = false;
        void setIsKioskMode(null);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      ownsNativeFullscreenRef.current = false;
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [setIsKioskMode]);

  useHotkeys([['Escape', exitKioskMode]]);

  return {
    enterKioskMode,
    exitKioskMode,
    isKioskMode,
  };
}
