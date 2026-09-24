import { screen } from '@testing-library/react';

import DashboardsListPage from '@/components/Dashboards/DashboardsListPage';
import type { Dashboard } from '@/dashboard';
import type { Favorite } from '@/favorites';

const mockQueryState = new Map<string, unknown>();
let mockDashboards: Dashboard[] = [];
let mockFavorites: Favorite[] = [];
let mockMe: { email: string } | null = null;
let mockMePending = false;
let mockFavoritesPending = false;
let mockTeamTags: string[] = [];

jest.mock('next/head', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('next/router', () => ({
  __esModule: true,
  default: { push: jest.fn() },
}));
jest.mock('nuqs', () => {
  const actual = jest.requireActual('nuqs');
  return {
    ...actual,
    useQueryState: (key: string, parser?: { defaultValue?: unknown }) => [
      mockQueryState.get(key) ?? parser?.defaultValue ?? null,
      jest.fn(),
    ],
  };
});
jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useMe: () => ({ data: mockMe, isPending: mockMePending }),
    useTags: () => ({ data: { data: mockTeamTags }, refetch: jest.fn() }),
  },
}));
jest.mock('@/dashboard', () => ({
  useDashboards: () => ({
    data: mockDashboards,
    isLoading: false,
    isError: false,
  }),
  useCreateDashboard: () => ({ mutate: jest.fn(), isPending: false }),
  useDeleteDashboard: () => ({ mutate: jest.fn() }),
}));
jest.mock('@/favorites', () => ({
  useFavorites: () => ({
    data: mockFavorites,
    isPending: mockFavoritesPending,
  }),
}));
jest.mock('@/layout', () => ({
  withAppNav: (component: unknown) => component,
}));
jest.mock('@/theme/ThemeProvider', () => ({
  useBrandDisplayName: () => 'HyperDX',
}));
jest.mock('@/useConfirm', () => ({
  useConfirm: () => jest.fn(),
}));
jest.mock('@/components/ListingCard', () => ({
  ListingCard: ({ name }: { name: string }) => <div>{name}</div>,
}));
jest.mock('@/components/AlertStatusIcon', () => ({
  AlertStatusIcon: () => null,
}));
jest.mock('@/config', () => ({
  IS_K8S_DASHBOARD_ENABLED: false,
}));

function makeDashboard(
  partial: Partial<Dashboard> & { id: string },
): Dashboard {
  return { name: partial.id, tiles: [], tags: [], ...partial };
}

function favorite(resourceId: string): Favorite {
  return { id: `fav-${resourceId}`, resourceType: 'dashboard', resourceId };
}

describe('DashboardsListPage', () => {
  beforeEach(() => {
    mockQueryState.clear();
    mockDashboards = [];
    mockFavorites = [];
    mockMe = { email: 'me@hyperdx.io' };
    mockMePending = false;
    mockFavoritesPending = false;
    mockTeamTags = [];
  });

  it('renders a multi-tag dashboard once rather than under each tag', () => {
    mockDashboards = [
      makeDashboard({ id: 'a', name: 'Checkout', tags: ['prod', 'billing'] }),
    ];

    renderWithMantine(<DashboardsListPage />);

    expect(screen.getAllByText('Checkout')).toHaveLength(1);
    expect(screen.queryByText('Untagged')).not.toBeInTheDocument();
  });

  it('offers the all, favorites and my dashboards tabs', () => {
    renderWithMantine(<DashboardsListPage />);

    expect(screen.getByTestId('dashboards-tab-all')).toBeInTheDocument();
    expect(screen.getByTestId('dashboards-tab-favorites')).toBeInTheDocument();
    expect(screen.getByTestId('dashboards-tab-mine')).toBeInTheDocument();
  });

  it('hides the my dashboards tab when the current user is unknown', () => {
    mockMe = null;

    renderWithMantine(<DashboardsListPage />);

    expect(screen.queryByTestId('dashboards-tab-mine')).not.toBeInTheDocument();
  });

  it('shows favorited dashboards only on the favorites tab', () => {
    mockQueryState.set('tab', 'favorites');
    mockFavorites = [favorite('a')];
    mockDashboards = [
      makeDashboard({ id: 'a', name: 'Checkout' }),
      makeDashboard({ id: 'b', name: 'Staging' }),
    ];

    renderWithMantine(<DashboardsListPage />);

    expect(screen.getByText('Checkout')).toBeInTheDocument();
    expect(screen.queryByText('Staging')).not.toBeInTheDocument();
  });

  it('no longer pins favorites above the list on the all tab', () => {
    mockFavorites = [favorite('a')];
    mockDashboards = [makeDashboard({ id: 'a', name: 'Checkout' })];

    renderWithMantine(<DashboardsListPage />);

    expect(
      screen.queryByTestId('favorite-dashboards-section'),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText('Checkout')).toHaveLength(1);
  });

  it('defaults the sort to last updated', () => {
    renderWithMantine(<DashboardsListPage />);

    expect(screen.getByTestId('dashboards-sort-select')).toHaveValue(
      'Last updated',
    );
  });

  it('orders the grid by the selected sort', () => {
    mockQueryState.set('sort', 'name');
    mockDashboards = [
      makeDashboard({ id: 'c', name: 'Checkout' }),
      makeDashboard({ id: 'a', name: 'Alerts' }),
    ];

    renderWithMantine(<DashboardsListPage />);

    const names = screen
      .getAllByText(/^(Alerts|Checkout)$/)
      .map(node => node.textContent);
    expect(names).toEqual(['Alerts', 'Checkout']);
  });

  it('tells the user the favorites tab is empty rather than the whole list', () => {
    mockQueryState.set('tab', 'favorites');
    mockDashboards = [makeDashboard({ id: 'a', name: 'Checkout' })];

    renderWithMantine(<DashboardsListPage />);

    expect(screen.getByText('No favorite dashboards yet')).toBeInTheDocument();
  });

  it('keeps only dashboards that carry every selected tag', () => {
    mockQueryState.set('tag', ['prod', 'billing']);
    mockDashboards = [
      makeDashboard({
        id: 'a',
        name: 'Checkout',
        tags: ['prod', 'billing'],
      }),
      makeDashboard({ id: 'b', name: 'Prod only', tags: ['prod'] }),
    ];

    renderWithMantine(<DashboardsListPage />);

    expect(screen.getByText('Checkout')).toBeInTheDocument();
    expect(screen.queryByText('Prod only')).not.toBeInTheDocument();
  });

  it('shows the selected tag count on the filter button rather than pills', () => {
    mockQueryState.set('tag', ['prod', 'billing']);
    mockDashboards = [
      makeDashboard({ id: 'a', name: 'Checkout', tags: ['prod', 'billing'] }),
    ];

    renderWithMantine(<DashboardsListPage />);

    expect(screen.getByTestId('dashboards-tag-filter')).toHaveTextContent(
      'Tags2',
    );
  });

  // The label stays put so the count appearing cannot resize the toolbar.
  it('keeps the filter button label unchanged before anything is selected', () => {
    mockDashboards = [
      makeDashboard({ id: 'a', name: 'Checkout', tags: ['prod'] }),
    ];

    renderWithMantine(<DashboardsListPage />);

    expect(screen.getByTestId('dashboards-tag-filter').textContent).toBe(
      'Tags',
    );
  });

  it('hides the tag filter when no dashboard carries a tag', () => {
    mockDashboards = [makeDashboard({ id: 'a', name: 'Checkout' })];

    renderWithMantine(<DashboardsListPage />);

    expect(
      screen.queryByTestId('dashboards-tag-filter'),
    ).not.toBeInTheDocument();
  });

  it('keeps the tag filter reachable when a shared filter matches no tag', () => {
    mockQueryState.set('tag', ['deleted-tag']);
    mockDashboards = [makeDashboard({ id: 'a', name: 'Checkout' })];

    renderWithMantine(<DashboardsListPage />);

    expect(screen.getByTestId('dashboards-tag-filter')).toBeInTheDocument();
  });

  it('falls back to the all tab when a shared mine link has no current user', () => {
    mockQueryState.set('tab', 'mine');
    mockMe = null;
    mockDashboards = [
      makeDashboard({
        id: 'a',
        name: 'Checkout',
        createdBy: { email: 'someone@hyperdx.io' },
      }),
    ];

    renderWithMantine(<DashboardsListPage />);

    expect(screen.getByTestId('dashboards-tab-all')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('Checkout')).toBeInTheDocument();
  });

  it('shows the all tab while the current user and favorites are still loading', () => {
    mockMePending = true;
    mockFavoritesPending = true;
    mockDashboards = [makeDashboard({ id: 'a', name: 'Checkout' })];

    renderWithMantine(<DashboardsListPage />);

    expect(screen.getByText('Checkout')).toBeInTheDocument();
    expect(screen.queryByText('Loading dashboards...')).not.toBeInTheDocument();
  });

  it('waits for favorites before judging the favorites tab empty', () => {
    mockQueryState.set('tab', 'favorites');
    mockFavoritesPending = true;
    mockDashboards = [makeDashboard({ id: 'a', name: 'Checkout' })];

    renderWithMantine(<DashboardsListPage />);

    expect(screen.getByText('Loading dashboards...')).toBeInTheDocument();
    expect(
      screen.queryByText('No favorite dashboards yet'),
    ).not.toBeInTheDocument();
  });

  it('waits for the current user before judging the mine tab empty', () => {
    mockQueryState.set('tab', 'mine');
    mockMe = null;
    mockMePending = true;
    mockDashboards = [
      makeDashboard({
        id: 'a',
        name: 'Checkout',
        createdBy: { email: 'me@hyperdx.io' },
      }),
    ];

    renderWithMantine(<DashboardsListPage />);

    expect(screen.getByText('Loading dashboards...')).toBeInTheDocument();
    expect(
      screen.queryByText('No dashboards created by you yet'),
    ).not.toBeInTheDocument();
  });
});
