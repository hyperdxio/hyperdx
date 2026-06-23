import React from 'react';
import { screen, within } from '@testing-library/react';

import DashboardsListPage from '../DashboardsListPage';

const mockSetSelectedTags = jest.fn();
const mockSetLegacyTag = jest.fn();
const mockUseDashboards = jest.fn();
const mockUseFavorites = jest.fn();
const mockUseCreateDashboard = jest.fn();
const mockUseDeleteDashboard = jest.fn();
const mockUseConfirm = jest.fn();
const mockUseBrandDisplayName = jest.fn();

let mockSelectedTags: string[] = [];
let mockLegacyTag: string | null = null;

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
    return [null, jest.fn()];
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
  mockSetSelectedTags.mockClear();
  mockSetLegacyTag.mockClear();
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
});
