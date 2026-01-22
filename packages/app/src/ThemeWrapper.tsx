import React from 'react';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { ClickUIProvider } from '@clickhouse/click-ui';

import { ClickUIThemeVars } from './theme/ClickUIThemeVars';
import { makeTheme, theme as defaultTheme } from './theme/mantineTheme';

export const ThemeWrapper = ({
  fontFamily,
  colorScheme = 'dark',
  children,
}: {
  fontFamily?: string;
  colorScheme?: 'dark' | 'light';
  children: React.ReactNode;
}) => {
  const theme = React.useMemo(
    () => (fontFamily ? makeTheme({ fontFamily }) : defaultTheme),
    [fontFamily],
  );
  return (
    <MantineProvider forceColorScheme={colorScheme} theme={theme}>
      <ClickUIProvider theme={colorScheme}>
        <ClickUIThemeVars />
        <Notifications zIndex={999999} />
        {children}
      </ClickUIProvider>
    </MantineProvider>
  );
};
