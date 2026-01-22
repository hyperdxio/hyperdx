import { ThemeConfig } from '../../types';

import Logomark from './Logomark';
import { theme } from './mantineTheme';
import Wordmark from './Wordmark';

export const hyperdxTheme: ThemeConfig = {
  name: 'hyperdx',
  displayName: 'HyperDX',
  mantineTheme: theme,
  Wordmark,
  Logomark,
  cssClass: 'theme-hyperdx',
  favicon: {
    svg: '/favicons/hyperdx/favicon.svg',
    png32: '/favicons/hyperdx/favicon-32x32.png',
    png16: '/favicons/hyperdx/favicon-16x16.png',
    appleTouchIcon: '/favicons/hyperdx/apple-touch-icon.png',
    themeColor: '#25292e', // Dark background
  },
};
