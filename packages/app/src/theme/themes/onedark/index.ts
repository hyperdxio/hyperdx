import { ThemeConfig } from '../../types';
import Logomark from '../_shared/Logomark';
import Wordmark from '../_shared/Wordmark';

import { theme } from './mantineTheme';

export const onedarkTheme: ThemeConfig = {
  name: 'onedark',
  displayName: 'One Dark',
  mantineTheme: theme,
  Wordmark,
  Logomark,
  cssClass: 'theme-onedark',
  favicon: {
    svg: '/favicons/hyperdx/favicon.svg',
    png32: '/favicons/hyperdx/favicon-32x32.png',
    png16: '/favicons/hyperdx/favicon-16x16.png',
    appleTouchIcon: '/favicons/hyperdx/apple-touch-icon.png',
    themeColor: '#282C34',
  },
};
