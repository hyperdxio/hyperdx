import type { SavedSearchListApiResponse } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SavedSearchSwitcher } from '@/components/SavedSearches/SavedSearchSwitcher';

let mockSavedSearches: SavedSearchListApiResponse[] = [];
let mockFavoriteIds: string[] = [];

jest.mock('next/router', () => ({
  __esModule: true,
  default: { push: jest.fn() },
}));
jest.mock('@/savedSearch', () => ({
  useSavedSearches: () => ({ data: mockSavedSearches, isLoading: false }),
}));
jest.mock('@/favorites', () => ({
  useFavorites: () => ({
    data: mockFavoriteIds.map((resourceId, index) => ({
      id: `favorite-${index}`,
      resourceType: 'savedSearch',
      resourceId,
    })),
  }),
}));

function savedSearch(id: string, name: string): SavedSearchListApiResponse {
  return {
    id,
    name,
    tags: [],
    select: '*',
    where: '',
    whereLanguage: 'lucene',
    source: 'source-id',
  };
}

describe('SavedSearchSwitcher', () => {
  beforeEach(() => {
    mockSavedSearches = [
      savedSearch('checkout', 'Checkout errors'),
      savedSearch('staging', 'Staging logs'),
    ];
    mockFavoriteIds = [];
  });

  it('filters the list by name', async () => {
    const user = userEvent.setup();
    renderWithMantine(<SavedSearchSwitcher onManage={jest.fn()} />);

    await user.click(
      screen.getByRole('button', { name: 'Switch saved search' }),
    );
    await user.type(
      await screen.findByPlaceholderText('Find a saved search'),
      'staging',
    );

    expect(screen.getByText('Staging logs')).toBeInTheDocument();
    expect(screen.queryByText('Checkout errors')).not.toBeInTheDocument();
  });

  it('lists favorites first', async () => {
    const user = userEvent.setup();
    mockFavoriteIds = ['staging'];
    renderWithMantine(<SavedSearchSwitcher onManage={jest.fn()} />);

    await user.click(
      screen.getByRole('button', { name: 'Switch saved search' }),
    );

    const names = (await screen.findAllByRole('link')).map(link =>
      link.textContent?.trim(),
    );
    expect(names).toEqual(['Staging logs', 'Checkout errors']);
  });

  it('hands off to the drawer for full management', async () => {
    const user = userEvent.setup();
    const onManage = jest.fn();
    renderWithMantine(<SavedSearchSwitcher onManage={onManage} />);

    await user.click(
      screen.getByRole('button', { name: 'Switch saved search' }),
    );
    await user.click(await screen.findByTestId('manage-saved-searches'));

    expect(onManage).toHaveBeenCalled();
  });
});
