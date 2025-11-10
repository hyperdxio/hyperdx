import React from 'react';
import {
  ActionIcon,
  Button,
  MantineProvider,
  MantineThemeOverride,
  rem,
  Select,
} from '@mantine/core';
import { Notifications } from '@mantine/notifications';

const makeTheme = ({
  fontFamily = '"IBM Plex Sans", monospace',
}: {
  fontFamily?: string;
}): MantineThemeOverride => ({
  cursorType: 'pointer',
  fontFamily,
  primaryColor: 'green',
  primaryShade: 8,
  autoContrast: true,
  white: '#fff',
  fontSizes: {
    xxs: '11px',
    xs: '12px',
    sm: '13px',
    md: '15px',
    lg: '16px',
    xl: '18px',
  },
  spacing: {
    xxxs: 'calc(0.375rem * var(--mantine-scale))',
    xxs: 'calc(0.5rem * var(--mantine-scale))',
    xs: 'calc(0.625rem * var(--mantine-scale))',
    sm: 'calc(0.75rem * var(--mantine-scale))',
    md: 'calc(1rem * var(--mantine-scale))',
    lg: 'calc(1.25rem * var(--mantine-scale))',
    xl: 'calc(2rem * var(--mantine-scale))',
  },
  colors: {
    // https://mantine.dev/colors-generator/?color=09D99C
    green: [
      '#e2fff8',
      '#cefef0',
      '#a0fbe0',
      '#6df9cf',
      '#09D99C', // Toned Down
      '#2ff5b8',
      '#1ef5b3',
      '#09da9d',
      '#00c28a',
      '#00a875',
    ],
    // https://mantine.dev/colors-generator/?color=A1A1AA
    // Customized with FAFAFA, D7D8DB, A1A1AA
    gray: [
      '#FAFAFA', // Off White
      '#e6e6ee',
      '#D7D8DB', // Light Gray
      '#aeaeb7',
      '#A1A1AA', // Primary Gray
      '#868691',
      '#7e7e8b',
      '#6c6c79',
      '#5f5f6e',
      '#515264',
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
      '#14171b',
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
    Select: Select.extend({
      styles: {
        input: {
          border: '1px solid var(--color-border)',
        },
      },
    }),
    Input: {
      styles: {
        input: {
          backgroundColor: 'var(--color-bg-field)',
          border: '1px solid var(--color-border)',
        },
      },
    },
    Card: {
      styles: (_theme: any, props: any) => {
        if (props.variant === 'muted') {
          return {
            root: {
              backgroundColor: 'var(--color-bg-muted)',
              border: '1px solid var(--color-border)',
            },
          };
        }
        return {
          root: {
            backgroundColor: 'var(--color-bg-body)',
          },
        };
      },
    },
    Divider: {
      styles: {
        root: {
          borderColor: 'var(--color-border)',
          borderTopColor: 'var(--color-border)',
          '--divider-color': 'var(--color-border)',
          '--item-border-color': 'var(--color-border)',
        },
      },
    },
    Accordion: {
      styles: {
        control: {
          '--item-border-color': 'var(--color-border)',
        },
        item: {
          borderColor: 'var(--color-border)',
        },
      },
    },
    UnstyledButton: {
      styles: {
        root: {
          '--item-border-color': 'var(--color-border)',
        },
      },
    },
    Paper: {
      classNames: (_theme: any, props: any) => {
        if (props.variant === 'muted') {
          return {
            root: 'paper-muted',
          };
        }
        return {};
      },
      styles: (_theme: any, props: any) => {
        if (props.variant === 'muted') {
          return {
            root: {
              backgroundColor: 'var(--color-bg-muted)',
              border: '1px solid var(--color-border)',
            },
          };
        }
        return {};
      },
    },
    Button: Button.extend({
      vars: (theme, props) => {
        if (props.size === 'xxs') {
          return {
            root: {
              '--button-height': rem(22),
              '--button-padding-x': rem(4),
              '--button-fz': rem(12),
            },
          };
        }

        return { root: {} };
      },
    }),
    ActionIcon: ActionIcon.extend({
      defaultProps: {
        variant: 'subtle',
        color: 'gray',
      },
      styles: (theme, props) => {
        // Subtle variant stays transparent
        if (props.variant === 'subtle') {
          return {
            root: {
              backgroundColor: 'transparent !important',
              color: `${theme.colors.gray[0]} !important`,
              '&:hover': {
                backgroundColor: `${theme.colors.dark[6]} !important`,
              },
              '&:active': {
                backgroundColor: `${theme.colors.dark[5]} !important`,
              },
            },
          };
        }

        // Default variant
        if (props.variant === 'default') {
          return {
            root: {
              backgroundColor: `${theme.colors.dark[6]} !important`,
              color: `${theme.colors.gray[0]} !important`,
              border: 'none !important',
              '&:hover': {
                backgroundColor: `${theme.colors.dark[5]} !important`,
              },
              '&:active': {
                backgroundColor: `${theme.colors.dark[4]} !important`,
              },
            },
          };
        }

        return {};
      },
    }),
  },
});

export const ThemeWrapper = ({
  fontFamily,
  colorScheme = 'dark',
  children,
}: {
  fontFamily?: string;
  colorScheme?: 'dark' | 'light';
  children: React.ReactNode;
}) => {
  const theme = React.useMemo(() => makeTheme({ fontFamily }), [fontFamily]);

  return (
    <MantineProvider forceColorScheme={colorScheme} theme={theme}>
      <Notifications zIndex={999999} />
      {children}
    </MantineProvider>
  );
};
