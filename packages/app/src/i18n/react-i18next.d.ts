import { enResources } from './locales/en';

import 'i18next';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: typeof enResources;
    returnNull: false;
  }
}
