import { type ReactNode, useEffect } from 'react';

import i18n from '@/i18n';
import { useLocale } from '@/i18n/useLocale';

export function I18nProvider({ children }: { children: ReactNode }) {
  const { locale } = useLocale();

  useEffect(() => {
    document.documentElement.lang = locale;

    if (i18n.language !== locale) {
      void i18n.changeLanguage(locale);
    }
  }, [locale]);

  return children;
}
