export type FontConfig = {
  variable: string;
  fallback: string;
};

export const FONT_CONFIG: Record<string, FontConfig> = {
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

export const DEFAULT_FONT_CONFIG = FONT_CONFIG.Inter;

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
export const DEFAULT_MANTINE_FONT = `${DEFAULT_FONT_CONFIG.variable}, ${DEFAULT_FONT_CONFIG.fallback}`;

// UI options for font selection
export const OPTIONS_FONTS = [
  'IBM Plex Mono',
  'Roboto Mono',
  'Inter',
  'Roboto',
];
