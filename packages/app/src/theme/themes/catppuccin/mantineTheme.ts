import { MantineThemeOverride } from '@mantine/core';

import { makeIdeTheme } from '../_shared/makeIdeTheme';

export const theme: MantineThemeOverride = makeIdeTheme({
  primaryColor: 'mauve',
  primaryShade: { dark: 4, light: 6 },
  colors: {
    mauve: [
      '#f5f0ff',
      '#ecdeff',
      '#d8bfff',
      '#c3a0ff',
      '#cba6f7', // Mocha mauve
      '#b48ee8',
      '#8839ef', // Latte mauve
      '#7028d0',
      '#5a1db5',
      '#440f99',
    ],
    dark: [
      '#cdd6f4',
      '#bac2de',
      '#a6adc8',
      '#585b70',
      '#45475a',
      '#313244',
      '#181825',
      '#1e1e2e',
      '#11111b',
      '#0a0a14',
    ],
  },
});
