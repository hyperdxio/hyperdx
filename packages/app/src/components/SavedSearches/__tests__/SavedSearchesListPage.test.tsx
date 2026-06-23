import React from 'react';
import { screen, within } from '@testing-library/react';

import SavedSearchesListPage from '../SavedSearchesListPage';

const mockSetSelectedTags = jest.fn();
const mockSetLegacyTag = jest.fn();
const mockUseSavedSearches = jest.fn();
const mockUseFavorites = jest.fn();
const mockUseDeleteSavedSearch = jest.fn();
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

jest.mock('@/layout', () => ({
  withAppNav: (component: unknown) => component,
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

jest.mock('@/savedSearch', () => ({
  useSavedSearches: () => mockUseSavedSearches(),
  useDeleteSavedSearch: () => mockUseDeleteSavedSearch(),
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

const savedSearch = (
  id: string,
  name: string,
  tags: string[],
): {
  id: string;
  name: string;
  tags: string[];
  alerts: never[];
  updatedAt: string;
  updatedBy?: { name?: string; email?: string };
  createdBy?: { name?: string; email?: string };
} => ({
  id,
  name,
  tags,
  alerts: [],
  updatedAt: '2026-05-01T00:00:00.000Z',
  updatedBy: { name: 'tester' },
  createdBy: { name: 'tester' },
});

const seedSavedSearches = [
  savedSearch('s-untagged', 'Untagged search', []),
  savedSearch('s-checkout', 'Checkout search', ['checkout']),
  savedSearch('s-multi', 'Multi search', ['checkout', 'payments']),
  savedSearch('s-payments', 'Payments search', ['payments']),
];

beforeEach(() => {
  mockSelectedTags = [];
  mockLegacyTag = null;
  mockSetSelectedTags.mockClear();
  mockSetLegacyTag.mockClear();
  mockUseSavedSearches.mockReturnValue({
    data: seedSavedSearches,
    isLoading: false,
    isError: false,
  });
  mockUseFavorites.mockReturnValue({ data: [] });
  mockUseDeleteSavedSearch.mockReturnValue({ mutate: jest.fn() });
  mockUseConfirm.mockReturnValue(jest.fn());
  mockUseBrandDisplayName.mockReturnValue('HyperDX');
});

describe('SavedSearchesListPage', () => {
  it('renders each multi-tagged saved search exactly once when filtering by two tags (OR semantics)', () => {
    mockSelectedTags = ['checkout', 'payments'];

    renderWithMantine(<SavedSearchesListPage />);

    const grid = screen.getByTestId('saved-searches-list-page');

    expect(within(grid).getAllByText('Checkout search')).toHaveLength(1);
    expect(within(grid).getAllByText('Multi search')).toHaveLength(1);
    expect(within(grid).getAllByText('Payments search')).toHaveLength(1);
    expect(within(grid).queryByText('Untagged search')).toBeNull();
  });

  it('migrates legacy `?tag=foo` URLs onto the new `?tags=[foo]` state on mount', () => {
    mockLegacyTag = 'checkout';
    mockSelectedTags = [];

    renderWithMantine(<SavedSearchesListPage />);

    expect(mockSetSelectedTags).toHaveBeenCalledWith(['checkout']);
    expect(mockSetLegacyTag).toHaveBeenCalledWith(null);
  });

  it('shows the no-matches empty state when chips have any selection but match nothing', () => {
    mockSelectedTags = ['does-not-exist'];

    renderWithMantine(<SavedSearchesListPage />);

    expect(
      screen.getByText('No matching saved searches yet'),
    ).toBeInTheDocument();
  });
});
