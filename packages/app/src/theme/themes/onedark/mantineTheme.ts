import { MantineThemeOverride } from '@mantine/core';

import { makeIdeTheme } from '../_shared/makeIdeTheme';

export const theme: MantineThemeOverride = makeIdeTheme({
  primaryColor: 'blue',
  primaryShade: { dark: 4, light: 6 },
  colors: {
    blue: [
      '#eef3ff',
      '#dce6ff',
      '#b6caff',
      '#82acff',
      '#61afef', // One Dark blue
      '#4078f2', // One Light blue
      '#0184bc',
      '#0073a8',
      '#006090',
      '#004d78',
    ],
    dark: [
      '#abb2bf',
      '#828997',
      '#5c6370',
      '#4b5263',
      '#3e4451',
      '#353b45',
      '#2c313a',
      '#282c34',
      '#21252b',
      '#1d2025',
    ],
  },
});
