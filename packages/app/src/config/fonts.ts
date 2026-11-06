/** UI font. The app does not offer a font picker. */
export const MANTINE_FONT_MAP = {
  Inter: 'var(--font-inter), sans-serif',
} as const;

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

export function isContentFontSize(value: string): value is ContentFontSize {
  return value in CONTENT_FONT_SIZES;
}

export const OPTIONS_CONTENT_FONT_SIZE = [
  { label: 'Small', value: 'sm' },
  { label: 'Medium', value: 'md' },
  { label: 'Large', value: 'lg' },
];
