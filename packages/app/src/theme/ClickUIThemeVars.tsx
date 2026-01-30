import { useEffect } from 'react';
import { useCUITheme } from '@clickhouse/click-ui';

/**
 * Component that injects Click UI theme values as CSS variables.
 * This creates a bridge between Click UI's styled-components theme
 * and CSS/SCSS that needs to consume the theme values.
 *
 * CSS variables are prefixed with --cui- and follow the Click UI theme structure.
 */
export function ClickUIThemeVars() {
  const theme = useCUITheme();

  useEffect(() => {
    const root = document.documentElement;
    const global = theme.global;

    // Background colors
    root.style.setProperty(
      '--cui-color-background-default',
      global.color.background.default,
    );
    root.style.setProperty(
      '--cui-color-background-muted',
      global.color.background.muted,
    );
    root.style.setProperty(
      '--cui-color-background-sidebar',
      global.color.background.sidebar,
    );

    // Text colors
    root.style.setProperty(
      '--cui-color-text-default',
      global.color.text.default,
    );
    root.style.setProperty('--cui-color-text-muted', global.color.text.muted);
    root.style.setProperty(
      '--cui-color-text-disabled',
      global.color.text.disabled,
    );
    root.style.setProperty(
      '--cui-color-text-link-default',
      global.color.text.link.default,
    );
    root.style.setProperty(
      '--cui-color-text-link-hover',
      global.color.text.link.hover,
    );

    // Stroke/Border colors
    root.style.setProperty(
      '--cui-color-stroke-default',
      global.color.stroke.default,
    );
    root.style.setProperty(
      '--cui-color-stroke-muted',
      global.color.stroke.muted,
    );
    root.style.setProperty(
      '--cui-color-stroke-intense',
      global.color.stroke.intense,
    );

    // Accent colors
    root.style.setProperty(
      '--cui-color-accent-default',
      global.color.accent.default,
    );

    // Feedback colors
    root.style.setProperty(
      '--cui-color-feedback-info-background',
      global.color.feedback.info.background,
    );
    root.style.setProperty(
      '--cui-color-feedback-info-foreground',
      global.color.feedback.info.foreground,
    );
    root.style.setProperty(
      '--cui-color-feedback-success-background',
      global.color.feedback.success.background,
    );
    root.style.setProperty(
      '--cui-color-feedback-success-foreground',
      global.color.feedback.success.foreground,
    );
    root.style.setProperty(
      '--cui-color-feedback-warning-background',
      global.color.feedback.warning.background,
    );
    root.style.setProperty(
      '--cui-color-feedback-warning-foreground',
      global.color.feedback.warning.foreground,
    );
    root.style.setProperty(
      '--cui-color-feedback-danger-background',
      global.color.feedback.danger.background,
    );
    root.style.setProperty(
      '--cui-color-feedback-danger-foreground',
      global.color.feedback.danger.foreground,
    );
    root.style.setProperty(
      '--cui-color-feedback-neutral-background',
      global.color.feedback.neutral.background,
    );
    root.style.setProperty(
      '--cui-color-feedback-neutral-foreground',
      global.color.feedback.neutral.foreground,
    );

    // Chart colors
    root.style.setProperty(
      '--cui-color-chart-blue',
      global.color.chart.default.blue,
    );
    root.style.setProperty(
      '--cui-color-chart-orange',
      global.color.chart.default.orange,
    );
    root.style.setProperty(
      '--cui-color-chart-green',
      global.color.chart.default.green,
    );
    root.style.setProperty(
      '--cui-color-chart-fuchsia',
      global.color.chart.default.fuchsia,
    );
    root.style.setProperty(
      '--cui-color-chart-yellow',
      global.color.chart.default.yellow,
    );
    root.style.setProperty(
      '--cui-color-chart-violet',
      global.color.chart.default.violet,
    );
    root.style.setProperty(
      '--cui-color-chart-red',
      global.color.chart.default.red,
    );
    root.style.setProperty(
      '--cui-color-chart-teal',
      global.color.chart.default.teal,
    );

    // Shadow
    root.style.setProperty(
      '--cui-color-shadow-default',
      global.color.shadow.default,
    );

    // Outline
    root.style.setProperty(
      '--cui-color-outline-default',
      global.color.outline.default,
    );
  }, [theme]);

  return null;
}
