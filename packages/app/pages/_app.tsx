import React, { useEffect } from 'react';
import type { NextPage } from 'next';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { NextAdapter } from 'next-query-params';
import randomUUID from 'crypto-randomuuid';
import { enableMapSet } from 'immer';
import SSRProvider from 'react-bootstrap/SSRProvider';
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

import { IS_LOCAL_MODE } from '@/config';
import { ThemeWrapper } from '@/ThemeWrapper';
import { useConfirmModal } from '@/useConfirm';
import { QueryParamProvider as HDXQueryParamProvider } from '@/useQueryParam';
import { useBackground, useUserPreferences } from '@/useUserPreferences';

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/dates/styles.css';
import '@styles/globals.css';
import '@styles/app.scss';
import 'uplot/dist/uPlot.min.css';

// Polyfill crypto.randomUUID for non-HTTPS environments
if (typeof crypto !== 'undefined' && !crypto.randomUUID) {
  crypto.randomUUID = randomUUID;
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
  const background = useBackground(userPreferences);

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
    document.documentElement.className =
      userPreferences.theme === 'dark' ? 'hdx-theme-dark' : 'hdx-theme-light';
    // TODO: Remove after migration to Mantine
    document.body.style.fontFamily = userPreferences.font
      ? `"${userPreferences.font}", sans-serif`
      : '"IBM Plex Mono"';
  }, [userPreferences.theme, userPreferences.font]);

  const getLayout = Component.getLayout ?? (page => page);

  return (
    <React.Fragment>
      <Head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css"
        />
        <link rel="icon" type="image/png" sizes="32x32" href="/Icon32.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        ></link>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=0.75"
        />
        <meta name="theme-color" content="#25292e"></meta>
        <meta name="google" content="notranslate" />
        <ColorSchemeScript forceColorScheme="dark" />
      </Head>

      <SSRProvider>
        <HDXQueryParamProvider>
          <QueryParamProvider adapter={NextAdapter}>
            <QueryClientProvider client={queryClient}>
              <ThemeWrapper fontFamily={userPreferences.font}>
                {getLayout(<Component {...pageProps} />)}
                {confirmModal}
              </ThemeWrapper>
              <ReactQueryDevtools initialIsOpen={true} />
              {background}
            </QueryClientProvider>
          </QueryParamProvider>
        </HDXQueryParamProvider>
      </SSRProvider>
    </React.Fragment>
  );
}
