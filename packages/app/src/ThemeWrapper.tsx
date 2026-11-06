import React from 'react';
import { ClickUIProvider } from '@clickhouse/click-ui';
import { MantineProvider, MantineThemeOverride } from '@mantine/core';
import { Notifications } from '@mantine/notifications';

import { theme as baseTheme } from './theme/mantineTheme';

export const ThemeWrapper = ({
  fontFamily,
  colorScheme = 'dark',
  children,
}: {
  fontFamily?: string;
  colorScheme?: 'dark' | 'light';
  children: React.ReactNode;
}) => {
  const mantineTheme = React.useMemo<MantineThemeOverride>(() => {
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
  }, [fontFamily]);

  return (
    <MantineProvider forceColorScheme={colorScheme} theme={mantineTheme}>
      {/* User preferences determine the color mode, so click-ui should not persist preferences to localstorage. */}
      <ClickUIProvider theme={colorScheme} persistTheme={false}>
        <Notifications zIndex={999999} />
        {children}
      </ClickUIProvider>
    </MantineProvider>
  );
};
