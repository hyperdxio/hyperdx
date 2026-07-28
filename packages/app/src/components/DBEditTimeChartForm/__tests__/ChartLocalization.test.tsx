import { Granularity } from '@hyperdx/common-utils/dist/core/utils';
import { MantineProvider } from '@mantine/core';
import { act, render, screen } from '@testing-library/react';

import { GranularityPicker } from '@/GranularityPicker';
import i18n from '@/i18n';
import { restoreKoreanCatalog, setKoreanFixture } from '@/i18n/testing';

const renderWithProvider = (ui: React.ReactNode) =>
  render(<MantineProvider>{ui}</MantineProvider>);

describe('chart localization boundaries', () => {
  afterEach(async () => {
    restoreKoreanCatalog('charts');
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('renders English granularity labels by default', () => {
    renderWithProvider(<GranularityPicker value="auto" onChange={jest.fn()} />);

    expect(screen.getByDisplayValue('Auto Granularity')).toBeInTheDocument();
  });

  it('translates chart chrome from the catalog while falling back to English', async () => {
    setKoreanFixture('charts', { 'granularity.auto': '자동 세분화' });
    await act(async () => {
      await i18n.changeLanguage('ko');
    });

    const { rerender } = renderWithProvider(
      <GranularityPicker value="auto" onChange={jest.fn()} />,
    );

    // Reviewed Korean entry is consumed from the catalog.
    expect(screen.getByDisplayValue('자동 세분화')).toBeInTheDocument();

    // Untranslated entries fall back to English rather than showing a key.
    rerender(
      <MantineProvider>
        <GranularityPicker value={Granularity.OneMinute} onChange={jest.fn()} />
      </MantineProvider>,
    );
    expect(
      screen.getByDisplayValue('1 Minute Granularity'),
    ).toBeInTheDocument();
  });
});
