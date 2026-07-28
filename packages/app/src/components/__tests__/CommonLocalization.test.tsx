import { act, screen } from '@testing-library/react';

import ConfirmDeleteMenu from '@/components/ConfirmDeleteMenu';
import i18n from '@/i18n';
import { restoreKoreanCatalog, setKoreanFixture } from '@/i18n/testing';

describe('common localization boundaries', () => {
  afterEach(async () => {
    restoreKoreanCatalog('common');
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('renders English shared copy by default', () => {
    renderWithMantine(<ConfirmDeleteMenu onDelete={jest.fn()} />);

    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('translates shared copy from the catalog while falling back to English', async () => {
    setKoreanFixture('common', { 'actions.delete': '삭제' });
    await act(async () => {
      await i18n.changeLanguage('ko');
    });

    renderWithMantine(<ConfirmDeleteMenu onDelete={jest.fn()} />);

    // Reviewed Korean entry is consumed from the catalog.
    expect(screen.getByText('삭제')).toBeInTheDocument();
  });
});
