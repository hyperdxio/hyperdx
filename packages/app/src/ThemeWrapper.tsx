import React from 'react';
import { ClickUIProvider } from '@clickhouse/click-ui';
import { MantineProvider, MantineThemeOverride } from '@mantine/core';
import { Notifications } from '@mantine/notifications';

import { useAppTheme } from './theme/ThemeProvider';

export const ThemeWrapper = ({
  fontFamily,
  colorScheme = 'dark',
  children,
}: {
  fontFamily?: string;
  colorScheme?: 'dark' | 'light';
  children: React.ReactNode;
}) => {
  const { theme: appTheme } = useAppTheme();

  const mantineTheme = React.useMemo<MantineThemeOverride>(() => {
    // Start with the current theme's Mantine theme
    const baseTheme = appTheme.mantineTheme;

    // Override font family if provided
    if (fontFamily) {
      return {
        ...baseTheme,
        fontFamily,
        headings: {
          ...baseTheme.headings,
          fontFamily,
        },
      };
    }

    return baseTheme;
  }, [appTheme.mantineTheme, fontFamily]);

  return (
    <MantineProvider forceColorScheme={colorScheme} theme={mantineTheme}>
      <ClickUIProvider theme={colorScheme}>
        <Notifications zIndex={999999} />
        {children}
      </ClickUIProvider>
    </MantineProvider>
  );
};
