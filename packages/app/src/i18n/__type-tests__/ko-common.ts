import { common as englishCommon } from '@/i18n/locales/en/common';
import type { DeepPartial } from '@/i18n/types';

export const koreanCommon = {
  actions: {
    save: '저장',
  },
} satisfies DeepPartial<typeof englishCommon>;

export const invalidKoreanCommon = {
  actions: {
    // @ts-expect-error Translation keys must exist in the English catalog.
    unknown: 'unknown',
  },
} satisfies DeepPartial<typeof englishCommon>;
