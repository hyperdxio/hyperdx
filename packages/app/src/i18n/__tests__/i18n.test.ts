import i18n from '@/i18n';
import { DEFAULT_LOCALE, isSupportedLocale } from '@/i18n/config';
import { restoreKoreanCatalog, setKoreanFixture } from '@/i18n/testing';

afterEach(async () => {
  restoreKoreanCatalog('common');
  await i18n.changeLanguage(DEFAULT_LOCALE);
});

describe('i18n', () => {
  it('initializes synchronously with English translations', () => {
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.t('actions.save', { ns: 'common' })).toBe('Save');
  });

  it('recognizes supported locales', () => {
    expect(isSupportedLocale('en')).toBe(true);
    expect(isSupportedLocale('ko')).toBe(true);
    expect(isSupportedLocale('fr')).toBe(false);
    expect(isSupportedLocale(null)).toBe(false);
  });

  it('resolves reviewed Korean entries and falls back to English per key', async () => {
    setKoreanFixture('common', { 'actions.save': '저장' });
    await i18n.changeLanguage('ko');

    expect(i18n.t('actions.save', { ns: 'common' })).toBe('저장');
    expect(i18n.t('actions.cancel', { ns: 'common' })).toBe('Cancel');
  });
});
