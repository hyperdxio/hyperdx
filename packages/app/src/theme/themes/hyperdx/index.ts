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
};
