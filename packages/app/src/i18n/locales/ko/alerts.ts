import type { alerts as englishAlerts } from '@/i18n/locales/en/alerts';
import type { DeepPartial } from '@/i18n/types';

export const alerts = {} satisfies DeepPartial<typeof englishAlerts>;
