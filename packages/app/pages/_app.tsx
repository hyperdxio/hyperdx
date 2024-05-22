import React, { useEffect } from 'react';
import type { NextPage } from 'next';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { NextAdapter } from 'next-query-params';
import SSRProvider from 'react-bootstrap/SSRProvider';
import { QueryClient, QueryClientProvider } from 'react-query';
import { ReactQueryDevtools } from 'react-query/devtools';
import { QueryParamProvider } from 'use-query-params';
import {
  ColorSchemeScript,
  MantineProvider,
  MantineThemeOverride,
} from '@mantine/core';
import { Notifications } from '@mantine/notifications';

import { apiConfigs } from '../src/api';
import * as config from '../src/config';
import { useConfirmModal } from '../src/useConfirm';
import { QueryParamProvider as HDXQueryParamProvider } from '../src/useQueryParam';
import { UserPreferencesProvider } from '../src/useUserPreferences';

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '../styles/globals.css';
import '../styles/app.scss';
import '../src/LandingPage.scss';

const queryClient = new QueryClient();
import HyperDX from '@hyperdx/browser';

const mantineTheme: MantineThemeOverride = {
  fontFamily: 'IBM Plex Mono, sans-serif',
  primaryColor: 'green',
  primaryShade: 8,
  white: '#fff',
  fontSizes: {
    xs: '12px',
    sm: '13px',
    md: '15px',
    lg: '16px',
    xl: '18px',
  },
  colors: {
    green: [
      '#e2ffeb',
      '#cdffd9',
      '#9bfdb5',
      '#67fb8d',
      '#3bf96b',
      '#1ef956',
      '#03f84a',
      '#00dd3a',
      '#00c531',
      '#00aa23',
    ],
    dark: [
      '#C1C2C5',
      '#A6A7AB',
      '#909296',
      '#5C5F66',
      '#373A40',
      '#2C2E33',
      '#25262B',
      '#1A1B1E',
      '#141517',
      '#101113',
    ],
  },
  headings: {
    fontFamily: 'IBM Plex Mono, sans-serif',
  },
  components: {
    Modal: {
      styles: {
        header: {
          fontFamily: 'IBM Plex Mono, sans-serif',
          fontWeight: 'bold',
        },
      },
    },
    InputWrapper: {
      styles: {
        label: {
          marginBottom: 4,
        },
        description: {
          marginBottom: 8,
          lineHeight: 1.3,
        },
      },
    },
    Card: {
      styles: {
        root: {
          backgroundColor: '#191B1F',
        },
      },
    },
    Checkbox: {
      styles: {
        input: {
          cursor: 'pointer',
        },
        label: {
          cursor: 'pointer',
        },
      },
    },
  },
};

export type NextPageWithLayout<P = {}, IP = P> = NextPage<P, IP> & {
  getLayout?: (page: React.ReactElement) => React.ReactNode;
};

type AppPropsWithLayout = AppProps & {
  Component: NextPageWithLayout;
};

export default function MyApp({ Component, pageProps }: AppPropsWithLayout) {
  const confirmModal = useConfirmModal();

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
              <UserPreferencesProvider>
                <MantineProvider forceColorScheme="dark" theme={mantineTheme}>
                  <Notifications />
                  {getLayout(<Component {...pageProps} />)}
                </MantineProvider>
                <ReactQueryDevtools initialIsOpen={false} />
                {confirmModal}
              </UserPreferencesProvider>
            </QueryClientProvider>
          </QueryParamProvider>
        </HDXQueryParamProvider>
      </SSRProvider>
    </React.Fragment>
  );
}
