import type { InitOptions } from 'i18next';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { DEFAULT_LOCALE } from './config';
import { resources } from './resources';

const initOptions = {
  defaultNS: 'common',
  fallbackLng: DEFAULT_LOCALE,
  lng: DEFAULT_LOCALE,
  // i18next 26 renamed the synchronous initialization option to initAsync.
  initAsync: false,
  interpolation: {
    escapeValue: false,
  },
  resources,
  returnNull: false,
} satisfies InitOptions;

i18n.use(initReactI18next).init(initOptions);

export default i18n;
