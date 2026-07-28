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
  }, [setIsKioskMode]);

  const exitKioskMode = useCallback(() => {
    void setIsKioskMode(null);
  }, [setIsKioskMode]);

  // Only consume Escape while actually in kiosk mode, and never preventDefault.
  // Mantine's useHotkeys preventDefaults by default and listens on
  // documentElement, which bubbles before window-level Esc handlers (e.g. the
  // tile editor's docked settings panel). PreventDefaulting here marks the event
  // handled, so those handlers — which bail on `event.defaultPrevented` — look
  // dead while a panel is open. When kiosk mode is off the editor is what owns
  // Esc, so leave the event untouched.
  useHotkeys([
    [
      'Escape',
      () => {
        if (isKioskMode) exitKioskMode();
      },
      { preventDefault: false },
    ],
  ]);

  return {
    enterKioskMode,
    exitKioskMode,
    isKioskMode,
  };
}
