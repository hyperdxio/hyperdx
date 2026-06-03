import React from 'react';
import { screen, within } from '@testing-library/react';

import DashboardsListPage from '../DashboardsListPage';

const mockSetSelectedTags = jest.fn();
const mockSetLegacyTag = jest.fn();
const mockSetActiveViewId = jest.fn();
const mockSetRecentDays = jest.fn();
const mockSetWithAlerts = jest.fn();
const mockSetCreatedByMe = jest.fn();
const mockUseDashboards = jest.fn();
const mockUseFavorites = jest.fn();
const mockUseCreateDashboard = jest.fn();
const mockUseDeleteDashboard = jest.fn();
const mockUseListViews = jest.fn();
const mockUseDeleteListView = jest.fn();
const mockUseMe = jest.fn();
const mockUseConfirm = jest.fn();
const mockUseBrandDisplayName = jest.fn();

let mockSelectedTags: string[] = [];
let mockLegacyTag: string | null = null;
let mockActiveViewId: string | null = null;
let mockRecentDays: number | null = null;
let mockWithAlerts: boolean | null = null;
let mockCreatedByMe: boolean | null = null;

jest.mock('next/router', () => ({
  __esModule: true,
  default: { push: jest.fn() },
}));

jest.mock('next/head', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

jest.mock('@/layout', () => ({
  withAppNav: (component: unknown) => component,
}));

jest.mock('@/config', () => ({
  IS_K8S_DASHBOARD_ENABLED: false,
}));

jest.mock('nuqs', () => ({
  parseAsString: 'parseAsString',
  parseAsBoolean: 'parseAsBoolean',
  parseAsInteger: 'parseAsInteger',
  parseAsArrayOf: () => ({
    withDefault: () => ({
      withOptions: () => 'parseAsArrayOfString',
    }),
  }),
  useQueryState: (key: string) => {
    if (key === 'tags') return [mockSelectedTags, mockSetSelectedTags];
    if (key === 'tag') return [mockLegacyTag, mockSetLegacyTag];
    if (key === 'view') return [mockActiveViewId, mockSetActiveViewId];
    if (key === 'recentDays') return [mockRecentDays, mockSetRecentDays];
    if (key === 'withAlerts') return [mockWithAlerts, mockSetWithAlerts];
    if (key === 'createdByMe') return [mockCreatedByMe, mockSetCreatedByMe];
    return [null, jest.fn()];
  },
}));

jest.mock('@/listView', () => ({
  useListViews: () => mockUseListViews(),
  useDeleteListView: () => mockUseDeleteListView(),
  useCreateListView: () => ({ mutate: jest.fn(), isPending: false }),
  useUpdateListView: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useMe: () => mockUseMe(),
  },
}));

jest.mock('@/dashboard', () => ({
  useDashboards: () => mockUseDashboards(),
  useCreateDashboard: () => mockUseCreateDashboard(),
  useDeleteDashboard: () => mockUseDeleteDashboard(),
}));

jest.mock('@/favorites', () => ({
  useFavorites: () => mockUseFavorites(),
  useToggleFavorite: () => ({
    isFavorited: false,
    toggleFavorite: jest.fn(),
  }),
}));

jest.mock('@/theme/ThemeProvider', () => ({
  useBrandDisplayName: () => mockUseBrandDisplayName(),
}));

jest.mock('@/useConfirm', () => ({
  useConfirm: () => mockUseConfirm(),
}));

const dashboard = (
  id: string,
  name: string,
  tags: string[],
): {
  id: string;
  name: string;
  tags: string[];
  tiles: never[];
  updatedAt: string;
  updatedBy?: { name?: string; email?: string };
  createdBy?: { name?: string; email?: string };
} => ({
  id,
  name,
  tags,
  tiles: [],
  updatedAt: '2026-05-01T00:00:00.000Z',
  updatedBy: { name: 'tester' },
  createdBy: { name: 'tester' },
});

const seedDashboards = [
  dashboard('d-untagged', 'Untagged dash', []),
  dashboard('d-checkout', 'Checkout dash', ['checkout']),
  dashboard('d-multi', 'Multi dash', ['checkout', 'payments']),
  dashboard('d-payments', 'Payments dash', ['payments']),
];

beforeEach(() => {
  mockSelectedTags = [];
  mockLegacyTag = null;
  mockActiveViewId = null;
  mockRecentDays = null;
  mockWithAlerts = null;
  mockCreatedByMe = null;
  mockSetSelectedTags.mockClear();
  mockSetLegacyTag.mockClear();
  mockSetActiveViewId.mockClear();
  mockSetRecentDays.mockClear();
  mockSetWithAlerts.mockClear();
  mockSetCreatedByMe.mockClear();
  mockUseDashboards.mockReturnValue({
    data: seedDashboards,
    isLoading: false,
    isError: false,
  });
  mockUseFavorites.mockReturnValue({ data: [] });
  mockUseCreateDashboard.mockReturnValue({
    mutate: jest.fn(),
    isPending: false,
  });
  mockUseDeleteDashboard.mockReturnValue({ mutate: jest.fn() });
  mockUseListViews.mockReturnValue({ data: [], isLoading: false });
  mockUseDeleteListView.mockReturnValue({ mutate: jest.fn() });
  mockUseMe.mockReturnValue({
    data: { id: 'u-tester', email: 'tester@local' },
  });
  mockUseConfirm.mockReturnValue(jest.fn());
  mockUseBrandDisplayName.mockReturnValue('HyperDX');
});

describe('DashboardsListPage', () => {
  it('renders each multi-tagged dashboard exactly once when filtering by two tags (OR semantics)', () => {
    mockSelectedTags = ['checkout', 'payments'];

    renderWithMantine(<DashboardsListPage />);

    const grid = screen.getByTestId('dashboards-list-page');

    // The three tagged dashboards match (one tagged checkout, one
    // tagged payments, one tagged both). The untagged dashboard is
    // filtered out. The multi-tagged dashboard renders exactly once.
    expect(within(grid).getAllByText('Checkout dash')).toHaveLength(1);
    expect(within(grid).getAllByText('Multi dash')).toHaveLength(1);
    expect(within(grid).getAllByText('Payments dash')).toHaveLength(1);
    expect(within(grid).queryByText('Untagged dash')).toBeNull();
  });

  it('migrates legacy `?tag=foo` URLs onto the new `?tags=[foo]` state on mount', () => {
    mockLegacyTag = 'checkout';
    mockSelectedTags = [];

    renderWithMantine(<DashboardsListPage />);

    expect(mockSetSelectedTags).toHaveBeenCalledWith(['checkout']);
    expect(mockSetLegacyTag).toHaveBeenCalledWith(null);
  });

  it('shows the no-matches empty state when chips have any selection but match nothing', () => {
    mockSelectedTags = ['does-not-exist'];

    renderWithMantine(<DashboardsListPage />);

    expect(screen.getByText('No matching dashboards yet')).toBeInTheDocument();
  });

  it('filters the listing when the Created by me pill is active', () => {
    const ownedSeed = [
      dashboard('d-mine', 'Mine dash', []),
      dashboard('d-other', 'Other dash', []),
    ];
    ownedSeed[0].createdBy = { name: 'tester', email: 'tester@local' };
    ownedSeed[1].createdBy = { name: 'someone', email: 'someone@else' };
    mockUseDashboards.mockReturnValue({
      data: ownedSeed,
      isLoading: false,
      isError: false,
    });
    mockCreatedByMe = true;

    renderWithMantine(<DashboardsListPage />);

    const grid = screen.getByTestId('dashboards-list-page');
    expect(within(grid).getAllByText('Mine dash')).toHaveLength(1);
    expect(within(grid).queryByText('Other dash')).toBeNull();
  });

  it('filters the listing when the Recently updated pill is active', () => {
    const now = Date.now();
    const seed = [
      {
        ...dashboard('d-fresh', 'Fresh dash', []),
        updatedAt: new Date(now - 2 * 86_400_000).toISOString(),
      },
      {
        ...dashboard('d-stale', 'Stale dash', []),
        updatedAt: new Date(now - 30 * 86_400_000).toISOString(),
      },
    ];
    mockUseDashboards.mockReturnValue({
      data: seed,
      isLoading: false,
      isError: false,
    });
    mockRecentDays = 7;

    renderWithMantine(<DashboardsListPage />);

    const grid = screen.getByTestId('dashboards-list-page');
    expect(within(grid).getAllByText('Fresh dash')).toHaveLength(1);
    expect(within(grid).queryByText('Stale dash')).toBeNull();
  });

  it('filters the listing through the active list view rules', () => {
    const checkoutView = {
      id: 'view-1',
      name: 'Checkout team',
      resource: 'dashboard' as const,
      rules: [{ kind: 'tag-includes' as const, tag: 'checkout' }],
      combinator: 'all' as const,
      ordering: 0,
      isShared: false,
    };
    mockUseListViews.mockReturnValue({
      data: [checkoutView],
      isLoading: false,
    });
    mockActiveViewId = 'view-1';

    renderWithMantine(<DashboardsListPage />);

    const grid = screen.getByTestId('dashboards-list-page');

    // Only the two checkout-tagged dashboards are present; payments-only
    // and untagged are filtered by the active view.
    expect(within(grid).getAllByText('Checkout dash')).toHaveLength(1);
    expect(within(grid).getAllByText('Multi dash')).toHaveLength(1);
    expect(within(grid).queryByText('Payments dash')).toBeNull();
    expect(within(grid).queryByText('Untagged dash')).toBeNull();
  });
});
