import React from 'react';
import type { Preview } from '@storybook/react';
import { initialize, mswLoader } from 'msw-storybook-addon';
import { QueryClient, QueryClientProvider } from 'react-query';
import { QueryParamProvider } from 'use-query-params';
import { NextAdapter } from 'next-query-params';

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/dropzone/styles.css';

import '../styles/globals.css';
import '../styles/app.scss';

import { meHandler } from '../src/mocks/handlers';
import { ThemeWrapper } from '../src/ThemeWrapper';

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
      items: [
        { value: 'light', title: 'Light' },
        { value: 'dark', title: 'Dark' },
      ],
    },
  },
};

initialize();

const queryClient = new QueryClient();

const preview: Preview = {
  decorators: [
    (Story, context) => (
      <QueryClientProvider client={queryClient}>
        <QueryParamProvider adapter={NextAdapter}>
          <ThemeWrapper colorScheme={context.globals.theme || 'light'}>
            <Story />
          </ThemeWrapper>
        </QueryParamProvider>
      </QueryClientProvider>
    ),
  ],
  loaders: [mswLoader],
  parameters: {
    msw: {
      handlers: [meHandler],
    },
    backgrounds: { disable: true },
  },
};

export default preview;
