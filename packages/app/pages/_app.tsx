import React, { useEffect } from 'react';
import type { NextPage } from 'next';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { NextAdapter } from 'next-query-params';
import randomUUID from 'crypto-randomuuid';
import { enableMapSet } from 'immer';
import { QueryParamProvider } from 'use-query-params';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

import { DynamicFavicon } from '@/components/DynamicFavicon';
import {
  DEFAULT_FONT_VAR,
  FONT_VAR_MAP,
  MANTINE_FONT_MAP,
} from '@/config/fonts';
import { ibmPlexMono, inter, roboto, robotoMono } from '@/fonts';
import { AppThemeProvider, useAppTheme } from '@/theme/ThemeProvider';
import { ThemeWrapper } from '@/ThemeWrapper';
import { ConfirmProvider } from '@/useConfirm';
import { QueryParamProvider as HDXQueryParamProvider } from '@/useQueryParam';
import {
  SystemColorSchemeScript,
  useResolvedColorScheme,
  useUserPreferences,
} from '@/useUserPreferences';

import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/dropzone/styles.css';
import '@mantine/notifications/styles.css';
import '@styles/app.scss';
import '@styles/globals.css';
import '@xyflow/react/dist/style.css';
import 'uplot/dist/uPlot.min.css';

// Polyfill crypto.randomUUID for non-HTTPS environments
if (typeof crypto !== 'undefined' && !crypto.randomUUID) {
  crypto.randomUUID =
    randomUUID as () => `${string}-${string}-${string}-${string}-${string}`;
}

enableMapSet();

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: console.error,
  }),
  mutationCache: new MutationCache({
    onError: console.error,
  }),
});

export type NextPageWithLayout<P = object, IP = P> = NextPage<P, IP> & {
  getLayout?: (page: React.ReactElement) => React.ReactNode;
};

type AppPropsWithLayout = AppProps & {
  Component: NextPageWithLayout;
};

// Component that renders Head content requiring user preferences
// Must be rendered inside AppThemeProvider to avoid hydration mismatch
function AppHeadContent() {
  const { theme } = useAppTheme();

  return (
    <Head>
      <title>{theme.displayName}</title>
      <meta name="viewport" content="width=device-width, initial-scale=0.75" />
      <meta name="google" content="notranslate" />
      <SystemColorSchemeScript />
    </Head>
  );
}

// Component that uses user preferences for theme wrapper
// Must be rendered inside AppThemeProvider to avoid hydration mismatch
function AppContent({
  Component,
  pageProps,
}: {
  Component: NextPageWithLayout;
  pageProps: AppProps['pageProps'];
}) {
  const { userPreferences } = useUserPreferences();
  const resolvedColorScheme = useResolvedColorScheme();
  const { themeName } = useAppTheme();

  // ClickStack theme always uses Inter font - user preference is ignored
  // HyperDX theme allows user to select font preference
  const isClickStackTheme = themeName === 'clickstack';
  const effectiveFont = isClickStackTheme ? 'Inter' : userPreferences.font;
  const selectedMantineFont = effectiveFont
    ? MANTINE_FONT_MAP[effectiveFont] || undefined
    : undefined;

  useEffect(() => {
    // Update CSS variable for global font cascading
    if (typeof document !== 'undefined') {
      const fontVar = FONT_VAR_MAP[effectiveFont] || DEFAULT_FONT_VAR;
      document.documentElement.style.setProperty('--app-font-family', fontVar);
    }
  }, [effectiveFont]);

  const getLayout = Component.getLayout ?? (page => page);

  return (
    <ThemeWrapper
      fontFamily={selectedMantineFont}
      colorScheme={resolvedColorScheme}
    >
      <ConfirmProvider>
        {getLayout(<Component {...pageProps} />)}
      </ConfirmProvider>
    </ThemeWrapper>
  );
}

export default function MyApp({ Component, pageProps }: AppPropsWithLayout) {
  // Berg strip: removed the @hyperdx/browser self-instrumentation init.
  // The original code POSTed traces/logs to localhost:4318 every render
  // even with no collector running, producing one ERR_CONNECTION_REFUSED
  // pair per query in the network tab.

  useEffect(() => {
    // Apply font classes to html element for CSS variable resolution.
    // Although _document.tsx sets these server-side, they must be re-applied client-side
    // during hydration to ensure CSS variables are available for dynamic font switching.
    // This is critical for the --app-font-family CSS variable to work across all components.
    if (typeof document !== 'undefined') {
      const fontClasses = [
        ibmPlexMono.variable,
        robotoMono.variable,
        inter.variable,
        roboto.variable,
      ];
      document.documentElement.classList.add(...fontClasses);
    }
  }, []);

  return (
    <React.Fragment>
      <AppThemeProvider>
        <AppHeadContent />
        <DynamicFavicon />
        <HDXQueryParamProvider>
          <QueryParamProvider adapter={NextAdapter}>
            <QueryClientProvider client={queryClient}>
              <AppContent Component={Component} pageProps={pageProps} />
              <ReactQueryDevtools initialIsOpen={true} />
            </QueryClientProvider>
          </QueryParamProvider>
        </HDXQueryParamProvider>
      </AppThemeProvider>
    </React.Fragment>
  );
}
