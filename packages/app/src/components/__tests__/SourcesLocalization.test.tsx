/* eslint-disable @eslint-react/no-unnecessary-use-prefix -- jest.mock factories stand in for hooks. */
import { act, screen } from '@testing-library/react';

import { SourcesList } from '@/components/Sources/SourcesList';
import { useConnections } from '@/connection';
import i18n from '@/i18n';
import { restoreKoreanCatalog, setKoreanFixture } from '@/i18n/testing';
import { useSources } from '@/source';

jest.mock('next/router', () => ({
  useRouter: () => ({
    isReady: true,
    push: jest.fn(),
    query: {},
    pathname: '/',
  }),
}));
jest.mock('@/source', () => ({ useSources: jest.fn() }));
jest.mock('@/connection', () => ({ useConnections: jest.fn() }));
jest.mock('@/config', () => ({ IS_LOCAL_MODE: false }));
jest.mock('../Sources/SourceForm', () => ({ TableSourceForm: () => null }));

const asMock = (fn: unknown) => fn as jest.Mock;

describe('sources localization boundaries', () => {
  beforeEach(() => {
    asMock(useConnections).mockReturnValue({
      data: [],
      isLoading: false,
      refetch: jest.fn(),
    });
    asMock(useSources).mockReturnValue({
      data: [],
      isLoading: false,
      refetch: jest.fn(),
    });
  });

  afterEach(async () => {
    restoreKoreanCatalog('sources');
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('renders English source copy by default', () => {
    renderWithMantine(<SourcesList withCard={false} />);

    expect(
      screen.getByText('No data sources configured yet.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Add source')).toBeInTheDocument();
  });

  it('translates source copy from the catalog while falling back to English', async () => {
    setKoreanFixture('sources', {
      'list.emptyTitle': '아직 구성된 데이터 소스가 없습니다.',
    });
    await act(async () => {
      await i18n.changeLanguage('ko');
    });

    renderWithMantine(<SourcesList withCard={false} />);

    // Reviewed Korean entry is consumed from the catalog.
    expect(
      screen.getByText('아직 구성된 데이터 소스가 없습니다.'),
    ).toBeInTheDocument();

    // Untranslated entries fall back to English rather than showing a key.
    expect(
      screen.getByText('Add a source to start querying your data.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Add source')).toBeInTheDocument();
  });
});
