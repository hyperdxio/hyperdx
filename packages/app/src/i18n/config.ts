const SUPPORTED_LOCALES = ['en', 'ko'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export const isSupportedLocale = (locale: unknown): locale is Locale =>
  SUPPORTED_LOCALES.some(supportedLocale => supportedLocale === locale);
