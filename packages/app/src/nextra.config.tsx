import React from 'react';

import { useWordmark } from './theme/ThemeProvider';
// import NextraMain from './NextraMain';
import useNextraSeoProps from './useNextraSeoProps';

function ThemedLogo() {
  const Wordmark = useWordmark();
  return <Wordmark />;
}

const theme = {
  useNextSeoProps: useNextraSeoProps,
  logo: <ThemedLogo />,
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
