import React, { useEffect } from 'react';
import type { NextPage } from 'next';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { NextAdapter } from 'next-query-params';
import { enableMapSet } from 'immer';
import SSRProvider from 'react-bootstrap/SSRProvider';
import { QueryClient, QueryClientProvider } from 'react-query';
import { ReactQueryDevtools } from 'react-query/devtools';
import { QueryParamProvider } from 'use-query-params';
import HyperDX from '@hyperdx/browser';
import { ColorSchemeScript } from '@mantine/core';

import { apiConfigs } from '@/api';
import { ThemeWrapper } from '@/ThemeWrapper';
import { useConfirmModal } from '@/useConfirm';
import { QueryParamProvider as HDXQueryParamProvider } from '@/useQueryParam';
import { useBackground, useUserPreferences } from '@/useUserPreferences';

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@styles/globals.css';
import '@styles/app.scss';

enableMapSet();

const queryClient = new QueryClient();

export type NextPageWithLayout<P = {}, IP = P> = NextPage<P, IP> & {
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
    fetch('/api/config')
      .then(res => res.json())
      .then(_jsonData => {
        // Set API url dynamically for users who aren't rebuilding
        try {
          const url = new URL(_jsonData.apiServerUrl);
          if (url != null) {
            apiConfigs.prefixUrl = url.toString().replace(/\/$/, '');
          }
        } catch (err) {
          // ignore
        }

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
            tracePropagationTargets: [new RegExp(hostname ?? 'localhost', 'i')],
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
              </ThemeWrapper>
              <ReactQueryDevtools
                initialIsOpen={false}
                position="bottom-right"
              />
              {confirmModal}
              {background}
            </QueryClientProvider>
          </QueryParamProvider>
        </HDXQueryParamProvider>
      </SSRProvider>
    </React.Fragment>
  );
}
