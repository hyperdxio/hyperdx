import React from 'react';
import { screen, within } from '@testing-library/react';

import DashboardsListPage from '../DashboardsListPage';

const mockSetSelectedTags = jest.fn();
const mockSetLegacyTag = jest.fn();
const mockSetActiveViewId = jest.fn();
const mockUseDashboards = jest.fn();
const mockUseFavorites = jest.fn();
const mockUseCreateDashboard = jest.fn();
const mockUseDeleteDashboard = jest.fn();
const mockUseListViews = jest.fn();
const mockUseDeleteListView = jest.fn();
const mockUseConfirm = jest.fn();
const mockUseBrandDisplayName = jest.fn();

let mockSelectedTags: string[] = [];
let mockLegacyTag: string | null = null;
let mockActiveViewId: string | null = null;

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
  parseAsArrayOf: () => ({
    withDefault: () => ({
      withOptions: () => 'parseAsArrayOfString',
    }),
  }),
  useQueryState: (key: string) => {
    if (key === 'tags') return [mockSelectedTags, mockSetSelectedTags];
    if (key === 'tag') return [mockLegacyTag, mockSetLegacyTag];
    if (key === 'view') return [mockActiveViewId, mockSetActiveViewId];
    return [null, jest.fn()];
  },
}));

jest.mock('@/listView', () => ({
  useListViews: () => mockUseListViews(),
  useDeleteListView: () => mockUseDeleteListView(),
  useCreateListView: () => ({ mutate: jest.fn(), isPending: false }),
  useUpdateListView: () => ({ mutate: jest.fn(), isPending: false }),
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
  mockSetSelectedTags.mockClear();
  mockSetLegacyTag.mockClear();
  mockSetActiveViewId.mockClear();
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
