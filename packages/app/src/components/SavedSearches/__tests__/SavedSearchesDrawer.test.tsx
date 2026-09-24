import type { SavedSearchListApiResponse } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  duplicateName,
  SavedSearchesDrawer,
} from '@/components/SavedSearches/SavedSearchesDrawer';

let mockSavedSearches: SavedSearchListApiResponse[] = [];
let mockFavoriteIds: string[] = [];
const mockDelete = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockConfirm = jest.fn();

jest.mock('next/router', () => ({
  __esModule: true,
  default: { push: jest.fn() },
}));
jest.mock('@/savedSearch', () => ({
  useSavedSearches: () => ({
    data: mockSavedSearches,
    isLoading: false,
    isError: false,
  }),
  useDeleteSavedSearch: () => ({ mutate: mockDelete }),
  useCreateSavedSearch: () => ({ mutate: mockCreate }),
  useUpdateSavedSearch: () => ({ mutate: mockUpdate }),
}));
jest.mock('@/favorites', () => ({
  useFavorites: () => ({
    data: mockFavoriteIds.map((resourceId, index) => ({
      id: `favorite-${index}`,
      resourceType: 'savedSearch',
      resourceId,
    })),
  }),
  useToggleFavorite: () => ({
    isFavorited: false,
    toggleFavorite: jest.fn(),
  }),
}));
jest.mock('@/useConfirm', () => ({
  useConfirm: () => mockConfirm,
}));
jest.mock('@/components/AlertStatusIcon', () => ({
  AlertStatusIcon: () => null,
}));

function savedSearch({
  id,
  name,
  tags = [],
}: {
  id: string;
  name: string;
  tags?: string[];
}): SavedSearchListApiResponse {
  return {
    id,
    name,
    tags,
    select: '*',
    where: '',
    whereLanguage: 'lucene',
    source: 'source-id',
  };
}

describe('SavedSearchesDrawer', () => {
  beforeEach(() => {
    mockSavedSearches = [
      savedSearch({ id: 'checkout', name: 'Checkout errors', tags: ['prod'] }),
      savedSearch({ id: 'staging', name: 'Staging logs', tags: ['staging'] }),
    ];
    mockFavoriteIds = [];
    mockDelete.mockReset();
    mockCreate.mockReset();
    mockUpdate.mockReset();
    mockConfirm.mockReset();
  });

  describe('duplicateName', () => {
    it('suffixes the original name', () => {
      expect(duplicateName('Checkout errors', [])).toBe(
        'Checkout errors (copy)',
      );
    });

    it('counts up when earlier copies exist', () => {
      const existing = [
        { name: 'Checkout errors' },
        { name: 'Checkout errors (copy)' },
        { name: 'Checkout errors (copy 2)' },
      ];

      expect(duplicateName('Checkout errors', existing)).toBe(
        'Checkout errors (copy 3)',
      );
    });
  });

  it('searches names and tags in a compact list', async () => {
    const user = userEvent.setup();
    renderWithMantine(<SavedSearchesDrawer opened onClose={jest.fn()} />);

    await user.type(
      screen.getByPlaceholderText('Search saved searches'),
      'prod',
    );

    expect(screen.getByText('Checkout errors')).toBeInTheDocument();
    expect(screen.queryByText('Staging logs')).not.toBeInTheDocument();
  });

  it('shows only favorited searches on the Favorites tab', async () => {
    const user = userEvent.setup();
    mockFavoriteIds = ['checkout'];
    renderWithMantine(<SavedSearchesDrawer opened onClose={jest.fn()} />);

    await user.click(screen.getByRole('tab', { name: 'Favorites' }));

    expect(screen.getByText('Checkout errors')).toBeInTheDocument();
    expect(screen.queryByText('Staging logs')).not.toBeInTheDocument();
  });

  it('renames a saved search from the row menu', async () => {
    const user = userEvent.setup();
    renderWithMantine(<SavedSearchesDrawer opened onClose={jest.fn()} />);

    await user.click(
      screen.getByRole('button', { name: 'Actions for Checkout errors' }),
    );
    await user.click(await screen.findByTestId('saved-search-rename'));

    const input = await screen.findByTestId('saved-search-rename-input');
    await user.clear(input);
    await user.type(input, 'Checkout failures{Enter}');

    expect(mockUpdate).toHaveBeenCalledWith(
      { id: 'checkout', name: 'Checkout failures' },
      expect.any(Object),
    );
  });
});
