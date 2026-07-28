import { Provider as JotaiProvider } from 'jotai';
import { useTranslation } from 'react-i18next';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

import i18n from '@/i18n';
import { DEFAULT_LOCALE } from '@/i18n/config';
import { I18nProvider } from '@/i18n/I18nProvider';
import { restoreKoreanCatalog, setKoreanFixture } from '@/i18n/testing';
import { useLocale } from '@/i18n/useLocale';

const STORAGE_KEY = 'hdx-user-preferences';

function LocaleTestContent() {
  const { t } = useTranslation();
  const { setLocale } = useLocale();

  return (
    <>
      <span data-testid="save">{t('actions.save')}</span>
      <span data-testid="cancel">{t('actions.cancel')}</span>
      <button type="button" onClick={() => setLocale('ko')}>
        Switch to Korean
      </button>
    </>
  );
}

describe('I18nProvider', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    document.documentElement.lang = DEFAULT_LOCALE;
    await act(async () => {
      await i18n.changeLanguage(DEFAULT_LOCALE);
    });
  });

  afterEach(async () => {
    cleanup();
    window.localStorage.removeItem(STORAGE_KEY);
    document.documentElement.lang = DEFAULT_LOCALE;
    restoreKoreanCatalog('common');
    await act(async () => {
      await i18n.changeLanguage(DEFAULT_LOCALE);
    });
  });

  it('synchronizes an explicitly selected locale while keeping untranslated text in English', async () => {
    // Only `actions.save` is reviewed here, so `actions.cancel` stands in for
    // a key that has not been translated yet.
    setKoreanFixture('common', { 'actions.save': '저장' });

    render(
      <JotaiProvider>
        <I18nProvider>
          <LocaleTestContent />
        </I18nProvider>
      </JotaiProvider>,
    );

    expect(screen.getByTestId('save')).toHaveTextContent('Save');
    expect(screen.getByTestId('cancel')).toHaveTextContent('Cancel');

    await act(async () => {
      screen.getByRole('button', { name: 'Switch to Korean' }).click();
    });

    await waitFor(() => {
      expect(i18n.language).toBe('ko');
      expect(document.documentElement.lang).toBe('ko');
    });

    expect(screen.getByTestId('save')).toHaveTextContent('저장');
    expect(screen.getByTestId('cancel')).toHaveTextContent('Cancel');
  });
});
