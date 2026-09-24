import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SavedSearchSwitcher } from '@/components/SavedSearches/SavedSearchSwitcher';

describe('SavedSearchSwitcher', () => {
  it('opens the drawer in one click', async () => {
    const user = userEvent.setup();
    const onOpen = jest.fn();
    renderWithMantine(<SavedSearchSwitcher status="unsaved" onOpen={onOpen} />);

    await user.click(screen.getByTestId('saved-search-switcher'));

    expect(onOpen).toHaveBeenCalled();
  });

  it('reads "Saved searches" until a saved search is selected', () => {
    renderWithMantine(
      <SavedSearchSwitcher status="unsaved" onOpen={jest.fn()} />,
    );

    expect(screen.getByTestId('saved-search-switcher')).toHaveTextContent(
      'Saved searches',
    );
    expect(screen.queryByTestId('saved-search-name')).not.toBeInTheDocument();
    expect(screen.getByTestId('saved-search-status')).toHaveTextContent(
      'Unsaved',
    );
  });

  it('names the selected saved search', () => {
    renderWithMantine(
      <SavedSearchSwitcher name="Ops" status="saved" onOpen={jest.fn()} />,
    );

    expect(screen.getByTestId('saved-search-name')).toHaveTextContent('Ops');
    expect(screen.getByTestId('saved-search-switcher')).not.toHaveTextContent(
      'Saved searches',
    );
  });

  it.each([
    ['saved', 'Saved'],
    ['edited', 'Edited'],
  ] as const)('shows the %s status', (status, label) => {
    renderWithMantine(
      <SavedSearchSwitcher name="Ops" status={status} onOpen={jest.fn()} />,
    );

    expect(screen.getByTestId('saved-search-status')).toHaveTextContent(label);
  });
});
