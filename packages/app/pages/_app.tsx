import React, { useEffect } from 'react';
import type { NextPage } from 'next';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { NextAdapter } from 'next-query-params';
import SSRProvider from 'react-bootstrap/SSRProvider';
import { QueryClient, QueryClientProvider } from 'react-query';
import { ReactQueryDevtools } from 'react-query/devtools';
import { ToastContainer } from 'react-toastify';
import { QueryParamProvider } from 'use-query-params';
import {
  createEmotionCache,
  MantineProvider,
  MantineThemeOverride,
} from '@mantine/core';

import * as config from '../src/config';
import { useConfirmModal } from '../src/useConfirm';
import { QueryParamProvider as HDXQueryParamProvider } from '../src/useQueryParam';
import { UserPreferencesProvider } from '../src/useUserPreferences';

import 'react-toastify/dist/ReactToastify.css';
import '../styles/globals.css';
import '../styles/app.scss';
import '../src/LandingPage.scss';

const queryClient = new QueryClient();
import HyperDX from '@hyperdx/browser';

const mantineCache = createEmotionCache({ key: 'mantine', prepend: true });

const mantineTheme: MantineThemeOverride = {
  colorScheme: 'dark',
  fontFamily: 'IBM Plex Mono, sans-serif',
  primaryColor: 'green',
  primaryShade: 9,
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
    Table: {
      styles: theme => ({
        td: {
          color: theme.colors.dark[3],
          fontWeight: 'normal',
        },
      }),
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
        if (_jsonData?.apiKey) {
          let hostname;
          try {
            const url = new URL(_jsonData.apiServerUrl);
            hostname = url.hostname;
          } catch (err) {
            // console.log(err);
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
  });

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
      </Head>

      <SSRProvider>
        <HDXQueryParamProvider>
          <QueryParamProvider adapter={NextAdapter}>
            <QueryClientProvider client={queryClient}>
              <UserPreferencesProvider>
                <ToastContainer position="bottom-right" theme="dark" />
                <MantineProvider
                  emotionCache={mantineCache}
                  theme={mantineTheme}
                >
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
