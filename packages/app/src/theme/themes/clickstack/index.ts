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
};
