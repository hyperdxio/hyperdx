import React from 'react';

import Logo from './Logo';
// import NextraMain from './NextraMain';
import useNextraSeoProps from './useNextraSeoProps';

const theme = {
  useNextSeoProps: useNextraSeoProps,
  logo: <Logo />,
  footer: {
    text: 'Made with ♥ in San Francisco, © 2024 DeploySentinel, Inc.',
  },
  head: null,
  editLink: {
    component: null,
  },
  darkMode: false,
  feedback: { content: null },
  nextThemes: {
    forcedTheme: 'dark',
    defaultTheme: 'dark',
  },
  components: {},
  // main: NextraMain,
  gitTimestamp: null,
};
export default theme;
