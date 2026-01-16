import {
  ActionIcon,
  Button,
  MantineTheme,
  MantineThemeOverride,
  rem,
  Select,
  Text,
  Tooltip,
} from '@mantine/core';

export const makeTheme = ({
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
    green: [
      '#eafff6',
      '#cdfee7',
      '#a0fad5',
      '#63f2bf',
      '#25e2a5',
      '#00c28a',
      '#00a475',
      '#008362',
      '#00674e',
      '#005542',
    ],
    gray: [
      '#FAFAFA',
      '#e6e6ee',
      '#D7D8DB',
      '#aeaeb7',
      '#A1A1AA',
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
    ],
  },
  headings: {
    fontFamily,
  },
  components: {
    Tooltip: Tooltip.extend({
      styles: () => ({
        tooltip: {
          fontFamily: 'var(--mantine-font-family)',
        },
      }),
    }),
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
      styles: (_theme: MantineTheme, props: { variant?: string }) => {
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
      styles: (_theme: MantineTheme, props: { variant?: string }) => {
        const base = {
          control: {
            '--item-border-color': 'var(--color-border)',
          },
          item: {
            borderColor: 'var(--color-border)',
          },
        };
        if (props.variant === 'noPadding') {
          return {
            ...base,
            content: {
              paddingInline: 0,
            },
            control: {
              paddingInlineStart: 0,
            },
          };
        }
        return base;
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
      classNames: (_theme: MantineTheme, props: { variant?: string }) => {
        if (props.variant === 'muted') {
          return {
            root: 'paper-muted',
          };
        }
        return {};
      },
      styles: (_theme: MantineTheme, props: { variant?: string }) => {
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
            border: '1px solid var(--color-border)',
          },
        };
      },
    },
    Text: Text.extend({
      styles: (theme, props) => {
        if (props.variant === 'danger') {
          return {
            root: {
              color: 'var(--color-text-danger)',
            },
          };
        }
        return {};
      },
    }),
    Button: Button.extend({
      vars: (_theme, props) => {
        const baseVars: Record<string, string> = {};

        if (props.size === 'xxs') {
          baseVars['--button-height'] = rem(22);
          baseVars['--button-padding-x'] = rem(4);
          baseVars['--button-fz'] = rem(12);
        }

        // Use Mantine's built-in CSS vars for hover support
        if (props.variant === 'primary') {
          baseVars['--button-bg'] = 'var(--mantine-color-green-light)';
          baseVars['--button-hover'] = 'var(--mantine-color-green-light-hover)';
          baseVars['--button-color'] = 'var(--mantine-color-green-light-color)';
        }

        if (props.variant === 'secondary') {
          baseVars['--button-bg'] = 'var(--color-bg-body)';
          baseVars['--button-hover'] = 'var(--color-bg-hover)';
          baseVars['--button-color'] = 'var(--color-text)';
          baseVars['--button-bd'] = '1px solid var(--color-border)';
        }

        if (props.variant === 'danger') {
          baseVars['--button-bg'] = 'var(--mantine-color-red-light)';
          baseVars['--button-hover'] = 'var(--mantine-color-red-light-hover)';
          baseVars['--button-color'] = 'var(--mantine-color-red-light-color)';
        }

        return { root: baseVars };
      },
    }),
    SegmentedControl: {
      styles: {
        root: {
          background: 'var(--color-bg-field)',
        },
        indicator: {
          background: 'var(--color-bg-field-highlighted)',
        },
      },
    },
    ActionIcon: ActionIcon.extend({
      defaultProps: {
        variant: 'subtle',
        color: 'gray',
      },
      styles: (_theme, props) => {
        if (props.variant === 'subtle') {
          return {
            root: {
              backgroundColor: 'transparent',
              color: 'var(--color-text)',
              '&:hover': {
                backgroundColor: 'var(--color-bg-hover)',
              },
              '&:active': {
                backgroundColor: 'var(--color-bg-muted)',
              },
            },
          };
        }

        if (props.variant === 'default') {
          return {
            root: {
              backgroundColor: 'var(--color-bg-hover)',
              color: 'var(--color-text)',
              border: 'none',
              '&:hover': {
                backgroundColor: 'var(--color-bg-muted)',
              },
              '&:active': {
                backgroundColor: 'var(--color-bg-muted)',
              },
            },
          };
        }

        if (props.variant === 'primary') {
          return {
            root: {
              backgroundColor: 'var(--mantine-color-green-light)',
              color: 'var(--mantine-color-green-light-color)',
              '&:hover': {
                backgroundColor: 'var(--mantine-color-green-light-hover)',
              },
            },
          };
        }

        if (props.variant === 'secondary') {
          return {
            root: {
              backgroundColor: 'var(--color-bg-surface)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
              '&:hover': {
                backgroundColor: 'var(--color-bg-hover)',
              },
            },
          };
        }

        if (props.variant === 'danger') {
          return {
            root: {
              backgroundColor: 'var(--mantine-color-red-light)',
              color: 'var(--mantine-color-red-light-color)',
              '&:hover': {
                backgroundColor: 'var(--mantine-color-red-light-hover)',
              },
            },
          };
        }

        return {};
      },
    }),
  },
});

export const theme = makeTheme({});
