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
 * `<Alert variant="...">` → tinted background + accent color (title/icon).
 * The Alert body text keeps Mantine's high-contrast default color; only the
 * title and icon take the semantic accent, which keeps the callout readable
 * even for low-contrast hues like warning yellow.
 */
export const SEMANTIC_ALERT_VARS: Record<string, Record<string, string>> = {
  danger: {
    '--alert-bg': 'var(--mantine-color-red-light)',
    '--alert-color': 'var(--color-text-danger)',
  },
  warning: {
    '--alert-bg': 'var(--mantine-color-yellow-light)',
    '--alert-color': 'var(--color-text-warning)',
  },
  success: {
    '--alert-bg': 'var(--mantine-color-green-light)',
    '--alert-color': 'var(--color-text-success)',
  },
  info: {
    '--alert-bg': 'var(--mantine-color-blue-light)',
    '--alert-color': 'var(--mantine-color-blue-light-color)',
  },
};
