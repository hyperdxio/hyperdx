/**
 * Shared semantic component variants (danger / warning / success / info).
 *
 * These map the custom `variant` strings we intercept in each brand theme's
 * component overrides onto the semantic design tokens defined in
 * `_tokens.scss`. Keeping them here means HyperDX and ClickStack stay in sync
 * and there is a single source of truth for what each semantic variant means.
 */

/** `<Text variant="...">` → text color token. */
export const SEMANTIC_TEXT_COLORS: Record<string, string> = {
  danger: 'var(--color-text-danger)',
  warning: 'var(--color-text-warning)',
  success: 'var(--color-text-success)',
};

/**
 * `<Button variant="...">` / `<ActionIcon variant="...">` → tinted
 * background/hover/foreground. Uses the scheme-aware `--color-bg-*-subtle`
 * tokens so the control reads as a soft, accessible tint rather than a solid
 * fill, with the semantic text token as the foreground.
 *
 * Only `danger` is exposed as a control variant; `warning`/`success` remain
 * available for `Text` and `Alert` but not as buttons.
 */
export const SEMANTIC_CONTROL_COLORS: Record<
  string,
  { bg: string; hover: string; color: string }
> = {
  danger: {
    bg: 'var(--color-bg-danger-subtle)',
    hover: 'var(--color-bg-danger-subtle-hover)',
    color: 'var(--color-text-danger)',
  },
};

/**
 * `<Alert variant="...">` → tinted background + semantic text color.
 *
 * The background uses the scheme-aware `--color-bg-*-subtle` tokens (defined in
 * each theme's `_tokens.scss` from Mantine's `-light` colors): a pale tint in
 * light mode, a muted dark tint in dark mode. `--alert-color` drives the title,
 * icon and — via the component `styles` override — the body text, so the whole
 * callout reads in the semantic color.
 */
const alertVars = (bg: string, accent: string): Record<string, string> => ({
  '--alert-bg': bg,
  '--alert-color': accent,
  '--alert-bd': '1px solid transparent',
});

export const SEMANTIC_ALERT_VARS: Record<string, Record<string, string>> = {
  danger: alertVars(
    'var(--color-bg-danger-subtle)',
    'var(--color-text-danger)',
  ),
  warning: alertVars(
    'var(--color-bg-warning-subtle)',
    'var(--color-text-warning)',
  ),
  success: alertVars(
    'var(--color-bg-success-subtle)',
    'var(--color-text-success)',
  ),
  info: alertVars('var(--color-bg-info-subtle)', 'var(--color-text-info)'),
};
