/* eslint-disable @eslint-react/no-unnecessary-use-prefix -- jest.mock factories stand in for hooks. */
import { MantineProvider } from '@mantine/core';
import { act, fireEvent, render, screen } from '@testing-library/react';

import DashboardsListPage from '@/components/Dashboards/DashboardsListPage';
import i18n from '@/i18n';
import { restoreKoreanCatalog, setKoreanFixture } from '@/i18n/testing';

const mockUseDashboards = jest.fn();
const mockConfirm = jest.fn();
const mockDelete = jest.fn();

jest.mock('next/router', () => ({
  __esModule: true,
  default: { push: jest.fn() },
}));
jest.mock('nuqs', () => ({ useQueryState: () => [null, jest.fn()] }));
jest.mock('@/layout', () => ({ withAppNav: (page: unknown) => page }));
jest.mock('@/theme/ThemeProvider', () => ({
  useBrandDisplayName: () => 'HyperDX',
}));
jest.mock('@/favorites', () => ({ useFavorites: () => ({ data: [] }) }));
jest.mock('@/useConfirm', () => ({ useConfirm: () => mockConfirm }));
jest.mock('@/dashboard', () => ({
  useDashboards: () => mockUseDashboards(),
  useCreateDashboard: () => ({ isPending: false, mutate: jest.fn() }),
  useDeleteDashboard: () => ({ mutate: mockDelete }),
}));
jest.mock('@/components/AlertStatusIcon', () => ({
  AlertStatusIcon: () => null,
}));
jest.mock('@/components/FavoriteButton', () => ({
  FavoriteButton: () => null,
}));
jest.mock('@/components/ListingCard', () => ({
  ListingCard: ({
    name,
    onDelete,
  }: {
    name: string;
    onDelete?: () => void;
  }) => (
    <div>
      <span>{name}</span>
      {onDelete && <button onClick={onDelete}>fixture-delete</button>}
    </div>
  ),
}));
jest.mock('@/components/ListingListRow', () => ({ ListingRow: () => null }));

const renderPage = () =>
  render(
    <MantineProvider>
      <DashboardsListPage />
    </MantineProvider>,
  );

describe('DashboardsListPage translations', () => {
  beforeEach(async () => {
    mockUseDashboards.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });
    mockConfirm.mockResolvedValue(false);
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  afterEach(async () => {
    restoreKoreanCatalog('dashboards');
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    jest.clearAllMocks();
  });

  it('renders English page, empty-state, and create copy from the catalog', () => {
    renderPage();

    expect(screen.getByText('Dashboards')).toBeInTheDocument();
    expect(screen.getByText('No dashboards yet')).toBeInTheDocument();
    expect(screen.getAllByText('New Dashboard')).not.toHaveLength(0);
  });

  it('uses Korean title with English fallback and preserves API names', async () => {
    mockUseDashboards.mockReturnValue({
      data: [
        {
          id: 'dashboard-1',
          name: 'Customer supplied dashboard',
          tiles: [],
          tags: [],
        },
      ],
      isLoading: false,
      isError: false,
    });
    setKoreanFixture('dashboards', { 'list.title': '검토용 대시보드' });
    await act(async () => {
      await i18n.changeLanguage('ko');
    });

    renderPage();

    expect(screen.getByText('검토용 대시보드')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search by name')).toBeInTheDocument();
    expect(screen.getByText('Customer supplied dashboard')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'fixture-delete' }));
    expect(mockConfirm).toHaveBeenCalledWith(
      'Are you sure you want to delete this dashboard? This action cannot be undone.',
      'Delete',
      { variant: 'danger' },
    );
  });
});
