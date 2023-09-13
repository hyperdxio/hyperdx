import Head from 'next/head';
import React, { useEffect } from 'react';
import SSRProvider from 'react-bootstrap/SSRProvider';
import type { AppProps } from 'next/app';
import { QueryClient, QueryClientProvider } from 'react-query';
import { ReactQueryDevtools } from 'react-query/devtools';
import { ToastContainer } from 'react-toastify';
import { NextAdapter } from 'next-query-params';
import { QueryParamProvider } from 'use-query-params';

import * as config from '../src/config';
import { QueryParamProvider as HDXQueryParamProvider } from '../src/useQueryParam';
import { UserPreferencesProvider } from '../src/useUserPreferences';

import 'react-toastify/dist/ReactToastify.css';

import '../styles/globals.css';
import '../styles/app.scss';
import '../src/LandingPage.scss';

const queryClient = new QueryClient();

import HyperDX from '@hyperdx/browser';

const HyperDXInitDefaultConfig = {
  ...(config.HDX_COLLECTOR_URL != null
    ? {
        url: config.HDX_COLLECTOR_URL,
      }
    : {}),
  consoleCapture: true,
  maskAllInputs: true,
  maskAllText: true,
  service: config.HDX_SERVICE_NAME,
  tracePropagationTargets: [/localhost/i, /hyperdx\.io/i],
};

export default function MyApp({ Component, pageProps }: AppProps) {
  // port to react query ? (needs to wrap with QueryClientProvider)
  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(_jsonData => {
        if (_jsonData?.apiKey) {
          HyperDX.init({
            ...HyperDXInitDefaultConfig,
            apiKey: _jsonData.apiKey,
          });
        }
      })
      .catch(err => {
        // ignore
      });
  });
  return (
    <React.Fragment>
      <Head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.7.1/font/bootstrap-icons.css"
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
      </Head>

      <SSRProvider>
        <HDXQueryParamProvider>
          <QueryParamProvider adapter={NextAdapter}>
            <QueryClientProvider client={queryClient}>
              <UserPreferencesProvider>
                <ToastContainer position="bottom-right" theme="dark" />
                <Component {...pageProps} />
                <ReactQueryDevtools initialIsOpen={false} />
              </UserPreferencesProvider>
            </QueryClientProvider>
          </QueryParamProvider>
        </HDXQueryParamProvider>
      </SSRProvider>
    </React.Fragment>
  );
}
