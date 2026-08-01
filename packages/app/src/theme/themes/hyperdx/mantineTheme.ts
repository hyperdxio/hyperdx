import {
  ActionIcon,
  Alert,
  Button,
  MantineTheme,
  MantineThemeOverride,
  rem,
  SegmentedControl,
  Select,
  Slider,
  Tabs,
  Text,
  Tooltip,
} from '@mantine/core';

import {
  SEMANTIC_ALERT_VARS,
  SEMANTIC_CONTROL_COLORS,
  SEMANTIC_TEXT_COLORS,
} from '@/theme/themes/semanticVariants';

import componentClasses from '@/theme/themes/components.module.scss';
import focusClasses from '@styles/focus.module.scss';
import variantClasses from '@styles/variants.module.scss';

const makeTheme = ({
  fontFamily = '"IBM Plex Sans", monospace',
}: {
  fontFamily?: string;
}): MantineThemeOverride => ({
  cursorType: 'pointer',
  defaultRadius: 'sm',
  fontFamily,
  focusClassName: focusClasses.focusRing,
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
    Slider: Slider.extend({
      vars: () => ({
        root: {
          '--slider-color': 'var(--color-slider-bar)',
        },
      }),
      styles: {
        thumb: {
          backgroundColor: 'var(--color-slider-thumb)',
          borderColor: 'var(--color-slider-thumb-border)',
        },
      },
      classNames: {
        mark: componentClasses.sliderMark,
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
    Alert: Alert.extend({
      vars: (_theme, props) => {
        if (props.variant && props.variant in SEMANTIC_ALERT_VARS) {
          return { root: SEMANTIC_ALERT_VARS[props.variant] };
        }
        return { root: {} };
      },
      styles: (_theme, props) => {
        // Body text follows the semantic accent color (title/icon already do
        // via --alert-color); Mantine otherwise forces the message to
        // black/white.
        if (props.variant && props.variant in SEMANTIC_ALERT_VARS) {
          return { message: { color: 'var(--alert-color)' } };
        }
        return {};
      },
    }),
    Text: Text.extend({
      styles: (_theme, props) => {
        if (props.variant && props.variant in SEMANTIC_TEXT_COLORS) {
          return {
            root: {
              color: SEMANTIC_TEXT_COLORS[props.variant],
            },
          };
        }
        return {};
      },
    }),
    Button: Button.extend({
      defaultProps: {
        variant: 'primary',
      },
      classNames: (_theme, props) => {
        if (props.variant === 'link') {
          return { root: variantClasses.buttonLink };
        }
        return {};
      },
      vars: (_theme, props) => {
        const baseVars: Record<string, string> = {};

        if (props.size === 'xxs') {
          baseVars['--button-height'] = rem(22);
          baseVars['--button-padding-x'] = rem(4);
          baseVars['--button-fz'] = rem(12);
        }

        // Use semantic CSS vars for primary button styling
        if (props.variant === 'primary') {
          baseVars['--button-bg'] = 'var(--color-primary-button-bg)';
          baseVars['--button-hover'] = 'var(--color-primary-button-bg-hover)';
          baseVars['--button-color'] = 'var(--color-primary-button-text)';
          baseVars['--button-hover-color'] = 'var(--color-primary-button-text)';
        }

        if (props.variant === 'secondary') {
          baseVars['--button-bg'] = 'var(--color-bg-body)';
          baseVars['--button-hover'] = 'var(--color-bg-muted)';
          baseVars['--button-color'] = 'var(--color-text)';
          baseVars['--button-bd'] = '1px solid var(--color-border)';
        }

        if (props.variant && props.variant in SEMANTIC_CONTROL_COLORS) {
          const c = SEMANTIC_CONTROL_COLORS[props.variant];
          baseVars['--button-bg'] = c.bg;
          baseVars['--button-hover'] = c.hover;
          baseVars['--button-color'] = c.color;
        }

        if (props.variant === 'subtle') {
          baseVars['--button-bg'] = 'transparent';
          baseVars['--button-hover'] = 'var(--color-bg-hover)';
          baseVars['--button-color'] = 'var(--color-text)';
          baseVars['--button-bd'] = 'none';
        }

        if (props.variant === 'link') {
          baseVars['--button-bg'] = 'transparent';
          baseVars['--button-hover'] = 'transparent';
          baseVars['--button-color'] = 'var(--color-text-secondary)';
          baseVars['--button-bd'] = 'none';
          baseVars['--button-padding-x'] = '0';
        }

        return { root: baseVars };
      },
    }),
    SegmentedControl: SegmentedControl.extend({
      styles: () => ({
        root: {
          background: 'var(--color-bg-field)',
        },
        indicator: {
          background: 'var(--color-bg-field-highlighted)',
        },
      }),
    }),
    Tabs: Tabs.extend({
      vars: () => ({
        root: {
          '--tabs-color': 'var(--color-text-brand)',
        },
      }),
      styles: {
        tabLabel: { textAlign: 'left' },
      },
    }),
    ActionIcon: ActionIcon.extend({
      defaultProps: {
        variant: 'subtle',
        color: 'gray',
      },
      classNames: (_theme, props) => {
        if (props.variant === 'link') {
          return { root: variantClasses.actionIconLink };
        }
        return {};
      },
      vars: (_theme, props) => {
        const baseVars: Record<string, string> = {};

        if (props.variant === 'subtle') {
          baseVars['--ai-bg'] = 'transparent';
          baseVars['--ai-hover'] = 'var(--color-bg-hover)';
          baseVars['--ai-color'] = 'var(--color-text)';
        }

        if (props.variant === 'default') {
          baseVars['--ai-bg'] = 'var(--color-bg-hover)';
          baseVars['--ai-hover'] = 'var(--color-bg-muted)';
          baseVars['--ai-color'] = 'var(--color-text)';
          baseVars['--ai-bd'] = 'none';
        }

        if (props.variant === 'primary') {
          baseVars['--ai-bg'] = 'var(--color-primary-button-bg)';
          baseVars['--ai-hover'] = 'var(--color-primary-button-bg-hover)';
          baseVars['--ai-color'] = 'var(--color-primary-button-text)';
        }

        if (props.variant === 'secondary') {
          baseVars['--ai-bg'] = 'var(--color-bg-surface)';
          baseVars['--ai-hover'] = 'var(--color-bg-hover)';
          baseVars['--ai-color'] = 'var(--color-text)';
          baseVars['--ai-bd'] = '1px solid var(--color-border)';
        }

        if (props.variant && props.variant in SEMANTIC_CONTROL_COLORS) {
          const c = SEMANTIC_CONTROL_COLORS[props.variant];
          baseVars['--ai-bg'] = c.bg;
          baseVars['--ai-hover'] = c.hover;
          baseVars['--ai-color'] = c.color;
        }

        if (props.variant === 'link') {
          baseVars['--ai-bg'] = 'transparent';
          baseVars['--ai-hover'] = 'transparent';
          baseVars['--ai-color'] = 'var(--color-text-secondary)';
          baseVars['--ai-bd'] = 'none';
        }

        return { root: baseVars };
      },
    }),
  },
});

export const theme = makeTheme({});
