import React from 'react';
import { MantineProvider, MantineThemeOverride } from '@mantine/core';
import { Notifications } from '@mantine/notifications';

const makeTheme = ({
  fontFamily = 'IBM Plex Sans, sans-serif',
}: {
  fontFamily?: string;
}): MantineThemeOverride => ({
  fontFamily,
  primaryColor: 'green',
  primaryShade: 8,
  white: '#fff',
  fontSizes: {
    xxs: '11px',
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
    fontFamily,
  },
  components: {
    Modal: {
      styles: {
        header: {
          fontFamily,
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
});

export const ThemeWrapper = ({
  fontFamily,
  children,
}: {
  fontFamily?: string;
  children: React.ReactNode;
}) => {
  const theme = React.useMemo(() => makeTheme({ fontFamily }), [fontFamily]);

  return (
    <MantineProvider forceColorScheme="dark" theme={theme}>
      <Notifications />
      {children}
    </MantineProvider>
  );
};
