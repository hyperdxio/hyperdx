import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SavedSearchSwitcher } from '@/components/SavedSearches/SavedSearchSwitcher';

describe('SavedSearchSwitcher', () => {
  it('opens the drawer in one click', async () => {
    const user = userEvent.setup();
    const onOpen = jest.fn();
    renderWithMantine(
      <SavedSearchSwitcher label="Checkout errors" onOpen={onOpen} />,
    );

    await user.click(screen.getByTestId('saved-search-switcher'));

    expect(onOpen).toHaveBeenCalled();
  });

  it('names the current search', () => {
    renderWithMantine(
      <SavedSearchSwitcher label="Checkout errors" onOpen={jest.fn()} />,
    );

    expect(screen.getByTestId('saved-search-name')).toHaveTextContent(
      'Checkout errors',
    );
  });

  it('dims the placeholder on an unsaved search', () => {
    renderWithMantine(
      <>
        <SavedSearchSwitcher label="Unsaved search" muted onOpen={jest.fn()} />
        <SavedSearchSwitcher label="Checkout errors" onOpen={jest.fn()} />
      </>,
    );

    const [placeholder, name] = screen.getAllByTestId('saved-search-name');

    expect(placeholder).toHaveStyle({ color: 'var(--mantine-color-dimmed)' });
    expect(name).not.toHaveStyle({ color: 'var(--mantine-color-dimmed)' });
  });
});
