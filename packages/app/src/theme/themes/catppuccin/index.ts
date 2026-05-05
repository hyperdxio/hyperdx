import { ThemeConfig } from '../../types';
import Logomark from '../_shared/Logomark';
import Wordmark from '../_shared/Wordmark';

import { theme } from './mantineTheme';

export const catppuccinTheme: ThemeConfig = {
  name: 'catppuccin',
  displayName: 'Catppuccin',
  mantineTheme: theme,
  Wordmark,
  Logomark,
  cssClass: 'theme-catppuccin',
  favicon: {
    svg: '/favicons/hyperdx/favicon.svg',
    png32: '/favicons/hyperdx/favicon-32x32.png',
    png16: '/favicons/hyperdx/favicon-16x16.png',
    appleTouchIcon: '/favicons/hyperdx/apple-touch-icon.png',
    themeColor: '#1E1E2E',
  },
};
