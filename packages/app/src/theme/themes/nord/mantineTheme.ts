import { MantineThemeOverride } from '@mantine/core';

import { makeIdeTheme } from '../_shared/makeIdeTheme';

export const theme: MantineThemeOverride = makeIdeTheme({
  primaryColor: 'blue',
  primaryShade: { dark: 3, light: 5 },
  colors: {
    blue: [
      '#e8f4f8',
      '#d0e8f0',
      '#a8d4e4',
      '#88c0d0', // Nord frost cyan
      '#81a1c1', // Nord frost blue
      '#5e81ac', // Nord frost dark blue
      '#4c6f9a',
      '#3a5d88',
      '#2a4b76',
      '#1a3964',
    ],
    dark: [
      '#d8dee9',
      '#c7cedd',
      '#adb5c0',
      '#8a929e',
      '#4c566a',
      '#434c5e',
      '#3b4252',
      '#2e3440',
      '#242933',
      '#1e2430',
    ],
  },
});
