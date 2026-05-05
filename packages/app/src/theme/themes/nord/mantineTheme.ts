import {
  ActionIcon,
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

import focusClasses from '../../../../styles/focus.module.scss';
import variantClasses from '../../../../styles/variants.module.scss';
import componentClasses from '../components.module.scss';

export const theme: MantineThemeOverride = {
  cursorType: 'pointer',
  defaultRadius: 'sm',
  fontFamily: '"IBM Plex Sans", monospace',
  focusClassName: focusClasses.focusRing,
  primaryColor: 'blue',
  primaryShade: { dark: 3, light: 5 },
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
    blue: [
      '#e8f4f8',
      '#d0e8f0',
      '#a8d4e4',
      '#88c0d0', // Nord frost cyan
      '#81a1c1', // Nord frost blue
      '#5e81ac', // Nord frost dark blue
      '#4c6f9a',
      '#3a5d88',
      '#2a4b76',
      '#1a3964',
    ],
    dark: [
      '#d8dee9',
      '#c7cedd',
      '#adb5c0',
      '#8a929e',
      '#4c566a',
      '#434c5e',
      '#3b4252',
      '#2e3440',
      '#242933',
      '#1e2430',
    ],
  },
  headings: {
    fontFamily: '"IBM Plex Sans", monospace',
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
          fontFamily: '"IBM Plex Sans", monospace',
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
            content: { paddingInline: 0 },
            control: { paddingInlineStart: 0 },
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
          return { root: 'paper-muted' };
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
        return { root: { border: '1px solid var(--color-border)' } };
      },
    },
    Text: Text.extend({
      styles: (_theme, props) => {
        if (props.variant === 'danger') {
          return { root: { color: 'var(--color-text-danger)' } };
        }
        return {};
      },
    }),
    Button: Button.extend({
      defaultProps: { variant: 'primary' },
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
        if (props.variant === 'primary') {
          baseVars['--button-bg'] = 'var(--color-primary-button-bg)';
          baseVars['--button-hover'] = 'var(--color-primary-button-bg-hover)';
          baseVars['--button-color'] = 'var(--color-primary-button-text)';
          baseVars['--button-color-hover'] = 'var(--color-primary-button-text)';
        }
        if (props.variant === 'secondary') {
          baseVars['--button-bg'] = 'var(--color-bg-body)';
          baseVars['--button-hover'] = 'var(--color-bg-muted)';
          baseVars['--button-color'] = 'var(--color-text)';
          baseVars['--button-bd'] = '1px solid var(--color-border)';
        }
        if (props.variant === 'danger') {
          baseVars['--button-bg'] = 'var(--mantine-color-red-light)';
          baseVars['--button-hover'] = 'var(--mantine-color-red-light-hover)';
          baseVars['--button-color'] = 'var(--mantine-color-red-light-color)';
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
        root: { background: 'var(--color-bg-field)' },
        indicator: { background: 'var(--color-bg-field-highlighted)' },
      }),
    }),
    Tabs: Tabs.extend({
      vars: () => ({
        root: { '--tabs-color': 'var(--color-text-brand)' },
      }),
      styles: {
        tabLabel: { textAlign: 'left' },
      },
    }),
    ActionIcon: ActionIcon.extend({
      defaultProps: { variant: 'subtle', color: 'gray' },
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
        if (props.variant === 'danger') {
          baseVars['--ai-bg'] = 'var(--mantine-color-red-light)';
          baseVars['--ai-hover'] = 'var(--mantine-color-red-light-hover)';
          baseVars['--ai-color'] = 'var(--mantine-color-red-light-color)';
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
};
