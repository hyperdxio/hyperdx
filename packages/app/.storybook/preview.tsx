import React from 'react';
import { initialize, mswLoader } from 'msw-storybook-addon';
import { NuqsAdapter } from 'nuqs/adapters/next/pages';
import type { Preview } from '@storybook/nextjs';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ibmPlexMono, inter, roboto, robotoMono } from '../src/fonts';
import { meHandler } from '../src/mocks/handlers';
import { ThemeWrapper } from '../src/ThemeWrapper';

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/dropzone/styles.css';
import '../styles/globals.css';
import '../styles/app.scss';

export const parameters = {
  layout: 'fullscreen',
  options: {
    showPanel: false,
    storySort: (a, b) =>
      a.title.localeCompare(b.title, undefined, { numeric: true }),
  },
};

export const globalTypes = {
  theme: {
    name: 'Theme',
    description: 'Mantine color scheme',
    defaultValue: 'light',
    toolbar: {
      icon: 'mirror',
      title: 'Theme',
      items: [
        { value: 'light', title: 'Light' },
        { value: 'dark', title: 'Dark' },
      ],
    },
  },
  font: {
    name: 'Font',
    description: 'App font family',
    defaultValue: 'inter',
    toolbar: {
      icon: 'typography',
      title: 'Font',
      items: [
        { value: 'inter', title: 'Inter' },
        { value: 'roboto', title: 'Roboto' },
        { value: 'ibm-plex-mono', title: 'IBM Plex Mono' },
        { value: 'roboto-mono', title: 'Roboto Mono' },
      ],
    },
  },
};

initialize();

const fontMap = {
  inter: inter,
  roboto: roboto,
  'ibm-plex-mono': ibmPlexMono,
  'roboto-mono': robotoMono,
};

// Create a new QueryClient for each story to avoid cache pollution between stories
const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
      },
    },
  });

const preview: Preview = {
  decorators: [
    (Story, context) => {
      // Create a fresh QueryClient for each story render
      const [queryClient] = React.useState(() => createQueryClient());

      const selectedFont = context.globals.font || 'inter';
      const font = fontMap[selectedFont as keyof typeof fontMap] || inter;
      const fontFamily = font.style.fontFamily;

      return (
        <div className={font.className}>
          <NuqsAdapter>
            <QueryClientProvider client={queryClient}>
              <ThemeWrapper
                colorScheme={context.globals.theme || 'light'}
                fontFamily={fontFamily}
              >
                <Story />
              </ThemeWrapper>
            </QueryClientProvider>
          </NuqsAdapter>
        </div>
      );
    },
  ],
  loaders: [mswLoader],
  parameters: {
    msw: {
      handlers: [meHandler],
    },
    backgrounds: { disabled: true },
  },
};

export default preview;
