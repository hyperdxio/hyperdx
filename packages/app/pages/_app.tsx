import React, { useEffect } from 'react';
import type { NextPage } from 'next';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import randomUUID from 'crypto-randomuuid';
import { enableMapSet } from 'immer';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

import { usePageTitle } from '@/brand';
import { MANTINE_FONT_MAP } from '@/config/fonts';
import { ibmPlexMono, inter, roboto, robotoMono } from '@/fonts';
import { fetchServerVersion, installHdxDebug } from '@/hdxDebug';
import { ThemeWrapper } from '@/ThemeWrapper';
import { ConfirmProvider } from '@/useConfirm';
import {
  SystemColorSchemeScript,
  useContentFontSize,
  useResolvedColorScheme,
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

function AppHeadContent() {
  const title = usePageTitle();

  return (
    <Head>
      <title>{title}</title>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="google" content="notranslate" />
      <SystemColorSchemeScript />
    </Head>
  );
}

function AppContent({
  Component,
  pageProps,
}: {
  Component: NextPageWithLayout;
  pageProps: AppProps['pageProps'];
}) {
  const resolvedColorScheme = useResolvedColorScheme();
  const { base: contentFontSize, compact: compactContentFontSize } =
    useContentFontSize();

  useEffect(() => {
    // Single write point for the content font size preference; tables and
    // chart CSS read these vars (see styles/app.scss for the defaults).
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty(
        '--hdx-content-font-size',
        `${contentFontSize}px`,
      );
      document.documentElement.style.setProperty(
        '--hdx-content-font-size-compact',
        `${compactContentFontSize}px`,
      );
    }
  }, [contentFontSize, compactContentFontSize]);

  const getLayout = Component.getLayout ?? (page => page);

  return (
    <ThemeWrapper
      fontFamily={MANTINE_FONT_MAP.Inter}
      colorScheme={resolvedColorScheme}
    >
      <ConfirmProvider>
        {getLayout(<Component {...pageProps} />)}
      </ConfirmProvider>
    </ThemeWrapper>
  );
}

export default function MyApp({ Component, pageProps }: AppPropsWithLayout) {
  // Expose build identity + debug helpers on window.hdx (all environments).
  // Installed once; the backend/API version (deployed separately) is fetched
  // from /api/health and read live via window.hdx's getters.
  useEffect(() => {
    installHdxDebug();
    fetchServerVersion();
  }, []);

  useEffect(() => {
    // Apply font classes to html so next/font CSS variables resolve.
    // _document.tsx sets these server-side; re-apply on the client so
    // portaled overlays inherit the same families.
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
      <AppHeadContent />
      <QueryClientProvider client={queryClient}>
        <AppContent Component={Component} pageProps={pageProps} />
        <ReactQueryDevtools initialIsOpen={true} />
      </QueryClientProvider>
    </React.Fragment>
  );
}
