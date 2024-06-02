import React from 'react';
import type { Preview } from '@storybook/react';
import { QueryClient, QueryClientProvider } from 'react-query';

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '../styles/globals.css';
import '../styles/app.scss';
import '../src/LandingPage.scss';

import { ThemeWrapper } from '../src/ThemeWrapper';

const queryClient = new QueryClient();

const preview: Preview = {
  decorators: [
    Story => (
      <QueryClientProvider client={queryClient}>
        <ThemeWrapper>
          <Story />
        </ThemeWrapper>
      </QueryClientProvider>
    ),
  ],
};

export default preview;
