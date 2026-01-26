import React, { useEffect } from 'react';
import type { NextPage } from 'next';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { NextAdapter } from 'next-query-params';
import randomUUID from 'crypto-randomuuid';
import { enableMapSet } from 'immer';
import { QueryParamProvider } from 'use-query-params';
import HyperDX from '@hyperdx/browser';
import { ColorSchemeScript } from '@mantine/core';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

import { DynamicFavicon } from '@/components/DynamicFavicon';
import { IS_LOCAL_MODE } from '@/config';
import {
  DEFAULT_FONT_VAR,
  FONT_VAR_MAP,
  MANTINE_FONT_MAP,
} from '@/config/fonts';
import { ibmPlexMono, inter, roboto, robotoMono } from '@/fonts';
import { getCurrentTheme } from '@/theme';
import { AppThemeProvider } from '@/theme/ThemeProvider';
import { ThemeWrapper } from '@/ThemeWrapper';
import { useConfirmModal } from '@/useConfirm';
import { QueryParamProvider as HDXQueryParamProvider } from '@/useQueryParam';
import { useUserPreferences } from '@/useUserPreferences';

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/dropzone/styles.css';
import '@styles/globals.css';
import '@styles/app.scss';
import 'uplot/dist/uPlot.min.css';
import '@xyflow/react/dist/style.css';

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

export default function MyApp({ Component, pageProps }: AppPropsWithLayout) {
  const { userPreferences } = useUserPreferences();
  const confirmModal = useConfirmModal();

  // Only override font if user has explicitly set a preference.
  // Otherwise, return undefined to let the theme use its default font:
  // - HyperDX theme: "IBM Plex Sans", monospace
  // - ClickStack theme: "Inter", sans-serif
  const selectedMantineFont = userPreferences.font
    ? MANTINE_FONT_MAP[userPreferences.font] || undefined
    : undefined;

  // port to react query ? (needs to wrap with QueryClientProvider)
  useEffect(() => {
    if (IS_LOCAL_MODE) {
      return;
    }
    fetch('/api/config')
      .then(res => res.json())
      .then(_jsonData => {
        if (_jsonData?.apiKey) {
          let hostname;
          try {
            const url = new URL(_jsonData.apiServerUrl);
            hostname = url.hostname;
          } catch (err) {
            // ignore
          }
          HyperDX.init({
            apiKey: _jsonData.apiKey,
            consoleCapture: true,
            maskAllInputs: true,
            maskAllText: true,
            service: _jsonData.serviceName,
            // tracePropagationTargets: [new RegExp(hostname ?? 'localhost', 'i')],
            url: _jsonData.collectorUrl,
          });
        } else {
          console.warn('No API key found');
        }
      })
      .catch(err => {
        // ignore
      });
  }, []);

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

  useEffect(() => {
    // Update CSS variable for global font cascading
    if (typeof document !== 'undefined') {
      const fontVar = FONT_VAR_MAP[userPreferences.font] || DEFAULT_FONT_VAR;
      document.documentElement.style.setProperty('--app-font-family', fontVar);
    }
  }, [userPreferences.font]);

  const getLayout = Component.getLayout ?? (page => page);

  // Get current theme for dynamic page title
  const currentTheme = getCurrentTheme();

  return (
    <React.Fragment>
      <Head>
        <title>{currentTheme.displayName}</title>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=0.75"
        />
        <meta name="google" content="notranslate" />
        <ColorSchemeScript
          forceColorScheme={
            userPreferences.colorMode === 'dark' ? 'dark' : 'light'
          }
        />
      </Head>

      <AppThemeProvider>
        <DynamicFavicon />
        <HDXQueryParamProvider>
          <QueryParamProvider adapter={NextAdapter}>
            <QueryClientProvider client={queryClient}>
              <ThemeWrapper
                fontFamily={selectedMantineFont}
                colorScheme={
                  userPreferences.colorMode === 'dark' ? 'dark' : 'light'
                }
              >
                {getLayout(<Component {...pageProps} />)}
                {confirmModal}
              </ThemeWrapper>
              <ReactQueryDevtools initialIsOpen={true} />
            </QueryClientProvider>
          </QueryParamProvider>
        </HDXQueryParamProvider>
      </AppThemeProvider>
    </React.Fragment>
  );
}
