import React from 'react';
import type { Preview } from '@storybook/react';

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '../styles/globals.css';
import '../styles/app.scss';
import '../src/LandingPage.scss';

import { ThemeWrapper } from '../src/ThemeWrapper';

const preview: Preview = {
  decorators: [
    Story => (
      <ThemeWrapper>
        <Story />
      </ThemeWrapper>
    ),
  ],
};

export default preview;
