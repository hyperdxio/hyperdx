import React from 'react';
import { DateInput } from '@mantine/dates';
import { act, render, screen } from '@testing-library/react';

import i18n from '@/i18n';
import { useLocale } from '@/i18n/useLocale';
import { ThemeWrapper } from '@/ThemeWrapper';

function LocaleSetter({ locale }: { locale: 'en' | 'ko' }) {
  const { setLocale } = useLocale();

  React.useEffect(() => {
    setLocale(locale);
  }, [locale, setLocale]);

  return null;
}

describe('ThemeWrapper date localization', () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('passes the selected locale to Mantine date components', async () => {
    render(
      <ThemeWrapper>
        <LocaleSetter locale="ko" />
        <DateInput
          label="date"
          value={new Date('2026-07-28T00:00:00Z')}
          onChange={jest.fn()}
          popoverProps={{ opened: true }}
        />
      </ThemeWrapper>,
    );

    // Korean weekday headers come from the dayjs locale registered by
    // ThemeWrapper; English would render "Mo"/"Tu"/…
    expect(await screen.findByText('월')).toBeInTheDocument();
  });
});
