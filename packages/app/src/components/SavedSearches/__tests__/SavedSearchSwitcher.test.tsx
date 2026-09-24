import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SavedSearchSwitcher } from '@/components/SavedSearches/SavedSearchSwitcher';

describe('SavedSearchSwitcher', () => {
  it('opens the drawer in one click', async () => {
    const user = userEvent.setup();
    const onOpen = jest.fn();
    renderWithMantine(
      <SavedSearchSwitcher name="Checkout errors" onOpen={onOpen} />,
    );

    await user.click(screen.getByTestId('saved-search-switcher'));

    expect(onOpen).toHaveBeenCalled();
  });

  it('names the current search', () => {
    renderWithMantine(
      <SavedSearchSwitcher name="Checkout errors" onOpen={jest.fn()} />,
    );

    expect(screen.getByTestId('saved-search-name')).toHaveTextContent(
      'Checkout errors',
    );
  });

  it('marks a search that has never been saved', () => {
    renderWithMantine(<SavedSearchSwitcher onOpen={jest.fn()} />);

    const badge = screen.getByTestId('saved-search-name');

    expect(badge).toHaveTextContent('Unsaved');
    expect(badge).toHaveStyle({ color: 'var(--mantine-color-dimmed)' });
  });

  it('keeps the entry point in place whether or not the search is saved', () => {
    renderWithMantine(
      <>
        <SavedSearchSwitcher onOpen={jest.fn()} />
        <SavedSearchSwitcher name="Checkout errors" onOpen={jest.fn()} />
      </>,
    );

    const [unsaved, saved] = screen.getAllByTestId('saved-search-switcher');

    expect(unsaved).toHaveTextContent('Saved searches');
    expect(saved).toHaveTextContent('Saved searches');
  });
});
