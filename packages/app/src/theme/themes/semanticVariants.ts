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
 * background/hover/foreground. Uses Mantine's generated `-light` triplet so
 * the control reads as a soft, accessible tint rather than a solid fill.
 */
export const SEMANTIC_CONTROL_COLORS: Record<
  string,
  { bg: string; hover: string; color: string }
> = {
  danger: {
    bg: 'var(--mantine-color-red-light)',
    hover: 'var(--mantine-color-red-light-hover)',
    color: 'var(--mantine-color-red-light-color)',
  },
  warning: {
    bg: 'var(--mantine-color-yellow-light)',
    hover: 'var(--mantine-color-yellow-light-hover)',
    color: 'var(--mantine-color-yellow-light-color)',
  },
  success: {
    bg: 'var(--mantine-color-green-light)',
    hover: 'var(--mantine-color-green-light-hover)',
    color: 'var(--mantine-color-green-light-color)',
  },
};

/**
 * `<Alert variant="...">` → tinted background + semantic text color.
 *
 * The background is derived with `color-mix` against `--color-bg-body`, which
 * is scheme-aware: mixing a small amount of the accent into white (light mode)
 * yields a very light tint, while mixing into the dark body (dark mode) yields
 * a correspondingly darker tint. `--alert-color` drives the title, icon and —
 * via the component `styles` override — the body text, so the whole callout
 * reads in the semantic color.
 */
const alertVars = (accent: string): Record<string, string> => ({
  '--alert-bg': `color-mix(in srgb, ${accent} 12%, var(--color-bg-body))`,
  '--alert-color': accent,
  '--alert-bd': '1px solid transparent',
});

export const SEMANTIC_ALERT_VARS: Record<string, Record<string, string>> = {
  danger: alertVars('var(--color-text-danger)'),
  warning: alertVars('var(--color-text-warning)'),
  success: alertVars('var(--color-text-success)'),
  info: alertVars('var(--mantine-color-blue-light-color)'),
};
