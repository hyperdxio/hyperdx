import { MantineProvider } from '@mantine/core';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import i18n from '@/i18n';
import { restoreKoreanCatalog, setKoreanFixture } from '@/i18n/testing';
import { UserPreferencesModal } from '@/UserPreferencesModal';

const STORAGE_KEY = 'hdx-user-preferences';
const originalScrollIntoView = Element.prototype.scrollIntoView;

describe('UserPreferencesModal', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn();
  });

  beforeEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        isUTC: false,
        timeFormat: '12h',
        colorMode: 'system',
        locale: 'en',
        font: 'IBM Plex Mono',
      }),
    );
  });

  afterEach(async () => {
    window.localStorage.clear();
    restoreKoreanCatalog('settings');
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  afterAll(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it('selects and persists Korean from the accessible language combobox', async () => {
    const user = userEvent.setup();

    render(
      <MantineProvider>
        <UserPreferencesModal opened onClose={jest.fn()} />
      </MantineProvider>,
    );

    const languageSelect = screen.getByRole('combobox', { name: 'Language' });
    await user.click(languageSelect);
    await user.keyboard('{ArrowDown}{Enter}');

    await waitFor(() => {
      expect(
        JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}'),
      ).toMatchObject({ locale: 'ko' });
    });
  });

  it('renders preference copy from the active translation catalog', async () => {
    setKoreanFixture('settings', { 'preferences.title': '검토용 설정' });
    await act(async () => {
      await i18n.changeLanguage('ko');
    });

    render(
      <MantineProvider>
        <UserPreferencesModal opened onClose={jest.fn()} />
      </MantineProvider>,
    );

    expect(screen.getByText('검토용 설정')).toBeInTheDocument();
  });
});
