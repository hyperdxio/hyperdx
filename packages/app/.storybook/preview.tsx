import React from 'react';
import { initialize, mswLoader } from 'msw-storybook-addon';
import type { Preview } from '@storybook/nextjs';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { MANTINE_FONT_MAP } from '../src/config/fonts';
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
  layout: 'centered',
  options: {
    showPanel: false,
    storySort: {
      order: [
        'Guidelines',
        'Brand',
        'Icons',
        'Design tokens',
        'Components',
        '*',
      ],
    },
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
};

initialize();

const NEXT_FONT_VARIABLE_CLASSES = [
  inter.variable,
  roboto.variable,
  ibmPlexMono.variable,
  robotoMono.variable,
];

/** Mirror `_document.tsx` + `_app.tsx`: font CSS vars live on <html> so body
 * and portaled overlays (Popover, Tooltip, Modal) inherit the same family.
 * The UI font is Inter. Mono faces stay loaded for logs and code. */
function StorybookFontSync() {
  React.useEffect(() => {
    const html = document.documentElement;
    html.classList.add(...NEXT_FONT_VARIABLE_CLASSES);
    html.style.setProperty('--app-font-family', 'var(--font-inter)');
  }, []);
  return null;
}

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
      const [queryClient] = React.useState(() => createQueryClient());

      const layout = context.parameters.layout ?? 'centered';

      return (
        <div
          className={inter.className}
          style={
            layout === 'fullscreen'
              ? { minHeight: '100vh' }
              : layout === 'centered'
                ? {
                    width: 'fit-content',
                    maxWidth: '100%',
                    marginInline: 'auto',
                  }
                : { width: '100%' }
          }
        >
          <StorybookFontSync />
          <QueryClientProvider client={queryClient}>
            <ThemeWrapper
              colorScheme={context.globals.theme || 'light'}
              fontFamily={MANTINE_FONT_MAP.Inter}
            >
              <Story />
            </ThemeWrapper>
          </QueryClientProvider>
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
