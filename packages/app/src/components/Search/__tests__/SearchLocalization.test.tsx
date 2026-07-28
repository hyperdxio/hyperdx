/* eslint-disable @eslint-react/no-unnecessary-use-prefix -- jest.mock factories stand in for hooks. */
import { MantineProvider } from '@mantine/core';
import { act, render, screen } from '@testing-library/react';

import DBRowSidePanelHeader from '@/components/DBRowSidePanelHeader';
import InputLanguageSwitch from '@/components/SearchInput/InputLanguageSwitch';
import i18n from '@/i18n';
import { restoreKoreanCatalog, setKoreanFixture } from '@/i18n/testing';

jest.mock('@/components/AISummarizeButton', () => () => null);
jest.mock('@/components/DBHighlightedAttributesList', () => ({
  DBHighlightedAttributesList: () => null,
}));
jest.mock('@/useUserPreferences', () => ({
  useUserPreferences: () => ({
    userPreferences: { expandSidebarHeader: false },
    setUserPreference: jest.fn(),
  }),
}));

const renderWithProvider = (ui: React.ReactNode) =>
  render(<MantineProvider>{ui}</MantineProvider>);

describe('search localization boundaries', () => {
  beforeEach(async () => {
    setKoreanFixture('search', {
      'input.queryLanguage': '쿼리 언어',
      'row.expand': '본문 펼치기',
    });
    await act(async () => {
      await i18n.changeLanguage('ko');
    });
  });

  afterEach(async () => {
    restoreKoreanCatalog('search');
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('translates query chrome without translating query language values', () => {
    renderWithProvider(
      <InputLanguageSwitch language="sql" onLanguageChange={jest.fn()} />,
    );

    expect(screen.getByRole('combobox', { name: '쿼리 언어' })).toHaveValue(
      'SQL',
    );
  });

  it('translates panel chrome without changing telemetry body content', () => {
    const telemetryBody = `service.name=checkout ${'x'.repeat(2100)}`;
    renderWithProvider(
      <DBRowSidePanelHeader mainContent={telemetryBody} bodyConfigured />,
    );

    expect(screen.getByText('본문 펼치기')).toBeInTheDocument();
    expect(screen.getByText(telemetryBody.slice(0, 2000))).toBeInTheDocument();
  });
});
