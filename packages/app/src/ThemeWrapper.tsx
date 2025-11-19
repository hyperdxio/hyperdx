import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';

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
  const theme = fontFamily ? makeTheme({ fontFamily }) : defaultTheme;
  return (
    <MantineProvider forceColorScheme={colorScheme} theme={theme}>
      <Notifications zIndex={999999} />
      {children}
    </MantineProvider>
  );
};
