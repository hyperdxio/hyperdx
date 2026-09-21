type FontConfig = {
  variable: string;
  fallback: string;
};

const FONT_CONFIG: Record<string, FontConfig> = {
  'IBM Plex Mono': {
    variable: 'var(--font-ibm-plex-mono)',
    fallback: 'monospace',
  },
  'Roboto Mono': {
    variable: 'var(--font-roboto-mono)',
    fallback: 'monospace',
  },
  Inter: {
    variable: 'var(--font-inter)',
    fallback: 'sans-serif',
  },
  Roboto: {
    variable: 'var(--font-roboto)',
    fallback: 'sans-serif',
  },
};

const DEFAULT_FONT_CONFIG = FONT_CONFIG.Inter;

// Derived maps for convenience
export const FONT_VAR_MAP = Object.entries(FONT_CONFIG).reduce(
  (acc, [name, config]) => {
    acc[name] = config.variable;
    return acc;
  },
  {} as Record<string, string>,
);

export const MANTINE_FONT_MAP = Object.entries(FONT_CONFIG).reduce(
  (acc, [name, config]) => {
    acc[name] = `${config.variable}, ${config.fallback}`;
    return acc;
  },
  {} as Record<string, string>,
);

export const DEFAULT_FONT_VAR = DEFAULT_FONT_CONFIG.variable;

// UI options for font selection
export const OPTIONS_FONTS = [
  'IBM Plex Mono',
  'Roboto Mono',
  'Inter',
  'Roboto',
];

export type ContentFontSize = 'sm' | 'md' | 'lg';

/**
 * Font sizes (px) for content surfaces: tables, chart axes, legends, tooltips.
 * `base` is body text, `compact` the secondary size used for chart chrome.
 * `sm` reproduces the sizes that were hardcoded before this was configurable,
 * so it must stay the default.
 */
export const CONTENT_FONT_SIZES: Record<
  ContentFontSize,
  { base: number; compact: number }
> = {
  sm: { base: 12, compact: 11 },
  md: { base: 14, compact: 13 },
  lg: { base: 16, compact: 15 },
};

export const DEFAULT_CONTENT_FONT_SIZE: ContentFontSize = 'sm';

export const OPTIONS_CONTENT_FONT_SIZE = [
  { label: 'Small', value: 'sm' },
  { label: 'Medium', value: 'md' },
  { label: 'Large', value: 'lg' },
];
