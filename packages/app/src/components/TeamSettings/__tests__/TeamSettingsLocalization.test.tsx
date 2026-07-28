import { act, screen } from '@testing-library/react';

import ConnectionsSection from '@/components/TeamSettings/ConnectionsSection';
import { useConnections } from '@/connection';
import i18n from '@/i18n';
import { restoreKoreanCatalog, setKoreanFixture } from '@/i18n/testing';

jest.mock('@/connection', () => ({ useConnections: jest.fn() }));
jest.mock('@/config', () => ({
  IS_CLICKHOUSE_BUILD: false,
  IS_LOCAL_MODE: false,
}));
jest.mock('@/components/ConnectionForm', () => ({
  ConnectionForm: () => null,
}));

const asMock = (fn: unknown) => fn as jest.Mock;

describe('team settings localization boundaries', () => {
  beforeEach(() => {
    asMock(useConnections).mockReturnValue({ data: [] });
  });

  afterEach(async () => {
    restoreKoreanCatalog('settings');
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('renders English settings copy by default', () => {
    renderWithMantine(<ConnectionsSection />);

    expect(screen.getByText('Connections')).toBeInTheDocument();
    expect(screen.getByText('Add Connection')).toBeInTheDocument();
  });

  it('translates settings copy from the catalog while falling back to English', async () => {
    setKoreanFixture('settings', { 'sections.connections': '연결' });
    await act(async () => {
      await i18n.changeLanguage('ko');
    });

    renderWithMantine(<ConnectionsSection />);

    // Reviewed Korean entry is consumed from the catalog.
    expect(screen.getByText('연결')).toBeInTheDocument();

    // Untranslated entries fall back to English rather than showing a key.
    expect(screen.getByText('Add Connection')).toBeInTheDocument();
  });
});
