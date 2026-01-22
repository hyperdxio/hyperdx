import { ThemeConfig } from '../../types';

import Logomark from './Logomark';
import { theme } from './mantineTheme';
import Wordmark from './Wordmark';

export const clickstackTheme: ThemeConfig = {
  name: 'clickstack',
  displayName: 'ClickStack',
  mantineTheme: theme,
  Wordmark,
  Logomark,
  cssClass: 'theme-clickstack',
  favicon: {
    svg: '/favicons/clickstack/favicon.svg',
    png32: '/favicons/clickstack/favicon-32x32.png',
    png16: '/favicons/clickstack/favicon-16x16.png',
    appleTouchIcon: '/favicons/clickstack/apple-touch-icon.png',
    themeColor: '#1a1a1a', // Dark background for ClickStack
  },
};
