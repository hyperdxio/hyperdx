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

  useHotkeys([['Escape', exitKioskMode]]);

  return {
    enterKioskMode,
    exitKioskMode,
    isKioskMode,
  };
}
