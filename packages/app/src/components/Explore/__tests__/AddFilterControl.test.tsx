import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AddFilterControl } from '@/components/Explore/AddFilterControl';
import type { FilterStateHook } from '@/searchFilters';

jest.mock('@/hooks/useMetadata', () => ({
  useGetKeyValues: jest.fn(() => ({ data: [], isFetching: false })),
}));

function renderControl() {
  renderWithMantine(
    <AddFilterControl
      fields={['ServiceName', 'StatusCode']}
      searchFilters={
        {
          filters: {},
          setFilterValue: jest.fn(),
          mergeFilterValues: jest.fn(),
        } as unknown as FilterStateHook
      }
    />,
  );
}

// The Add button is the one control in the form that never opens a list of its
// own, so it is a stable way back to the popover that wraps everything.
const popoverDropdown = () =>
  screen
    .getByRole('button', { name: 'Add', hidden: true })
    .closest('.mantine-Popover-dropdown');

describe('AddFilterControl', () => {
  // Rendered into a portal an option list sits outside the popover, so picking
  // from it counts as a click outside and takes the half-built filter with it.
  it.each([
    ['Filter field', 'ServiceName'],
    ['Filter operator', 'is not'],
  ])('renders the %s options inside the popover', async (label, option) => {
    const user = userEvent.setup();
    renderControl();

    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    // Select also renders a hidden input carrying the same label.
    await user.click(
      await screen.findByLabelText(label, {
        selector: 'input:not([type="hidden"])',
      }),
    );

    expect(popoverDropdown()).toContainElement(
      await screen.findByRole('option', { name: option, hidden: true }),
    );
  });
});
