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

/**
 * ClickStack Theme
 *
 * A distinct visual identity for ClickStack branding.
 * Primary color: Yellow/Gold accent
 * Style: Modern, professional
 */
export const makeTheme = ({
  fontFamily = '"Inter", sans-serif',
}: {
  fontFamily?: string;
}): MantineThemeOverride => ({
  cursorType: 'pointer',
  fontFamily,
  primaryColor: 'yellow',
  primaryShade: 6,
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
    // Note: Actual color values are overridden via CSS variables in _tokens.scss
    // These arrays are required for Mantine to recognize the colors
    // The CSS variables allow different palettes for light/dark modes
    yellow: [
      '#ffffe8', // Overridden by --mantine-color-yellow-0
      '#feffc2', // Overridden by --mantine-color-yellow-1
      '#fdffa3', // Overridden by --mantine-color-yellow-2
      '#faff69', // Overridden by --mantine-color-yellow-3
      '#eef400', // Overridden by --mantine-color-yellow-4
      '#c7cc00', // Overridden by --mantine-color-yellow-5
      '#959900', // Overridden by --mantine-color-yellow-6
      '#686b00', // Overridden by --mantine-color-yellow-7
      '#3c4601', // Overridden by --mantine-color-yellow-8
      '#333300', // Overridden by --mantine-color-yellow-9
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
      styles: (_theme, props) => {
        if (props.variant === 'primary') {
          return {
            root: {
              backgroundColor: 'var(--mantine-color-yellow-6)',
              color: 'var(--mantine-color-dark-9)',
              '&:hover': {
                backgroundColor: 'var(--mantine-color-yellow-5)',
              },
            },
          };
        }

        if (props.variant === 'secondary') {
          return {
            root: {
              backgroundColor: 'var(--color-bg-body)',
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
              backgroundColor: 'var(--mantine-color-yellow-6)',
              color: 'var(--mantine-color-dark-9)',
              '&:hover': {
                backgroundColor: 'var(--mantine-color-yellow-5)',
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
