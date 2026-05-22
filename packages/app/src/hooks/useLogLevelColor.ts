import { useMemo } from 'react';
import { useMantineColorScheme, useMantineTheme } from '@mantine/core';

import { useAppTheme } from '@/theme/ThemeProvider';
import {
  getChartColorError,
  getChartColorWarning,
  getLogLevelClass,
  logLevelColor,
} from '@/utils';

/**
 * Resolves log-level chart colors for the active brand.
 *
 * HyperDX info uses Mantine `green[6]` / `green[7]` from the live theme object
 * so colors stay correct when switching brands (CSS `var(--mantine-color-green-*)`
 * can lag behind `MantineProvider`). ClickStack and other brands use `logLevelColor`
 * (DOM / `--color-chart-info`).
 */
export function useLogLevelColor(): typeof logLevelColor {
  const { themeName } = useAppTheme();
  const mantineTheme = useMantineTheme();
  const { colorScheme } = useMantineColorScheme();
  const hyperdxGreen6 = mantineTheme.colors?.green?.[6];
  const hyperdxGreen7 = mantineTheme.colors?.green?.[7];

  return useMemo((): typeof logLevelColor => {
    if (
      themeName !== 'hyperdx' ||
      hyperdxGreen6 == null ||
      hyperdxGreen7 == null
    ) {
      return logLevelColor;
    }
    const effectiveScheme = colorScheme ?? 'dark';
    const infoHex = effectiveScheme === 'light' ? hyperdxGreen7 : hyperdxGreen6;
    return (key: string | number | undefined) => {
      const lvl = getLogLevelClass(`${key}`);
      if (lvl === 'error') {
        return getChartColorError();
      }
      if (lvl === 'warn') {
        return getChartColorWarning();
      }
      return infoHex;
    };
  }, [themeName, colorScheme, hyperdxGreen6, hyperdxGreen7]);
}
