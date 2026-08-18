import React from 'react';
import { initialize, mswLoader } from 'msw-storybook-addon';
import type { Preview } from '@storybook/nextjs';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  DEFAULT_FONT_VAR,
  FONT_VAR_MAP,
  MANTINE_FONT_MAP,
} from '../src/config/fonts';
import { ibmPlexMono, inter, roboto, robotoMono } from '../src/fonts';
import { meHandler } from '../src/mocks/handlers';
import { AppThemeProvider } from '../src/theme/ThemeProvider';
import { ThemeName } from '../src/theme/types';
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
  brand: {
    name: 'Brand',
    description: 'Brand theme',
    defaultValue: 'hyperdx',
    toolbar: {
      icon: 'paintbrush',
      title: 'Brand',
      items: [
        { value: 'hyperdx', title: 'HyperDX' },
        { value: 'clickstack', title: 'ClickStack' },
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
  inter: { nextFont: inter, name: 'Inter' },
  roboto: { nextFont: roboto, name: 'Roboto' },
  'ibm-plex-mono': { nextFont: ibmPlexMono, name: 'IBM Plex Mono' },
  'roboto-mono': { nextFont: robotoMono, name: 'Roboto Mono' },
} as const;

const NEXT_FONT_VARIABLE_CLASSES = [
  inter.variable,
  roboto.variable,
  ibmPlexMono.variable,
  robotoMono.variable,
];

/** Mirror `_document.tsx` + `_app.tsx`: font CSS vars live on <html> so body
 * and portaled overlays (Popover, Tooltip, Modal) inherit the same family. */
function StorybookFontSync({
  fontName,
  fontClassName,
}: {
  fontName: string;
  fontClassName: string;
}) {
  React.useEffect(() => {
    const html = document.documentElement;
    html.classList.add(...NEXT_FONT_VARIABLE_CLASSES);
    html.classList.add(fontClassName);
    html.style.setProperty(
      '--app-font-family',
      FONT_VAR_MAP[fontName] ?? DEFAULT_FONT_VAR,
    );
    return () => {
      html.classList.remove(fontClassName);
    };
  }, [fontName, fontClassName]);
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

      const selectedFont = context.globals.font || 'inter';
      const font =
        fontMap[selectedFont as keyof typeof fontMap] ?? fontMap.inter;
      const fontFamily = MANTINE_FONT_MAP[font.name] ?? MANTINE_FONT_MAP.Inter;
      const brandTheme = (context.globals.brand || 'hyperdx') as ThemeName;

      return (
        <div className={font.nextFont.className}>
          <StorybookFontSync
            fontName={font.name}
            fontClassName={font.nextFont.className}
          />
          <QueryClientProvider client={queryClient}>
            <AppThemeProvider themeName={brandTheme}>
              <ThemeWrapper
                colorScheme={context.globals.theme || 'light'}
                fontFamily={fontFamily}
              >
                <Story />
              </ThemeWrapper>
            </AppThemeProvider>
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
