import { act, fireEvent, screen } from '@testing-library/react';

import { TimePicker } from '@/components/TimePicker';
import {
  LIVE_TAIL_TIME_QUERY,
  RELATIVE_TIME_LABEL_KEYS,
  RELATIVE_TIME_OPTIONS,
} from '@/components/TimePicker/utils';
import i18n from '@/i18n';
import { enResources } from '@/i18n/locales/en';
import { restoreKoreanCatalog, setKoreanFixture } from '@/i18n/testing';

describe('TimePicker preset localization', () => {
  afterEach(async () => {
    restoreKoreanCatalog('common');
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  const renderPicker = (onSearch: jest.Mock) =>
    renderWithMantine(
      <TimePicker
        inputValue=""
        setInputValue={jest.fn()}
        onSearch={onSearch}
      />,
    );

  it('sends the English query value even when the menu is localized', async () => {
    setKoreanFixture('common', {
      'timePicker.presets.last1Hour': '최근 1시간',
    });
    await act(async () => {
      await i18n.changeLanguage('ko');
    });

    const onSearch = jest.fn();
    renderPicker(onSearch);

    fireEvent.click(screen.getByTestId('time-picker-input'));
    fireEvent.click(await screen.findByRole('button', { name: '최근 1시간' }));

    // chrono parses the English value, so only the label may be translated.
    expect(onSearch).toHaveBeenCalledWith('Last 1 hour');
  });

  it('falls back to the English label for presets without a Korean entry', async () => {
    setKoreanFixture('common', {
      'timePicker.presets.last1Hour': '최근 1시간',
    });
    await act(async () => {
      await i18n.changeLanguage('ko');
    });

    const onSearch = jest.fn();
    renderPicker(onSearch);

    fireEvent.click(screen.getByTestId('time-picker-input'));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Last 3 hours' }),
    );

    expect(onSearch).toHaveBeenCalledWith('Last 3 hours');
  });

  it('maps every preset to an English label identical to its query value', () => {
    const queries = [
      LIVE_TAIL_TIME_QUERY,
      ...RELATIVE_TIME_OPTIONS.filter(option => option !== 'divider').map(
        option => option[0],
      ),
    ];
    const english: Record<string, string> =
      enResources.common.timePicker.presets;

    const labelKeys: Record<string, string> = RELATIVE_TIME_LABEL_KEYS;

    for (const query of queries) {
      const key = labelKeys[query];

      expect(key).toBeDefined();
      // English users must see exactly the string that lands in the input.
      expect(english[key]).toBe(query);
    }
  });
});
