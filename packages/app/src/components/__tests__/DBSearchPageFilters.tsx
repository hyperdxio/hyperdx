import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FilterGroup } from '../DBSearchPageFilters';

describe('FilterGroup', () => {
  const defaultProps = {
    name: 'Test Filter',
    options: [
      { value: 'zebra', label: 'zebra' },
      { value: 'apple', label: 'apple' },
      { value: 'banana', label: 'banana' },
    ],
    onChange: jest.fn(),
    onClearClick: jest.fn(),
    onOnlyClick: jest.fn(),
  };

  it('should sort options alphabetically by default', () => {
    renderWithMantine(<FilterGroup {...defaultProps} />);

    const options = screen.getAllByRole('checkbox');
    expect(options).toHaveLength(3);
    const labels = screen.getAllByText(/apple|banana|zebra/);
    expect(labels[0]).toHaveTextContent('apple');
    expect(labels[1]).toHaveTextContent('banana');
    expect(labels[2]).toHaveTextContent('zebra');
  });

  it('should show selected items first, then sort alphabetically', () => {
    renderWithMantine(
      <FilterGroup
        {...defaultProps}
        selectedValues={new Set(['zebra', 'apple'])}
      />,
    );

    const options = screen.getAllByRole('checkbox');
    expect(options).toHaveLength(3);
    const labels = screen.getAllByText(/apple|banana|zebra/);
    expect(labels[0]).toHaveTextContent('apple');
    expect(labels[1]).toHaveTextContent('zebra');
    expect(labels[2]).toHaveTextContent('banana');
  });

  it('should handle more than MAX_FILTER_GROUP_ITEMS', async () => {
    const manyOptions = Array.from({ length: 15 }, (_, i) => ({
      value: `item${i}`,
      label: `item${i}`,
    }));

    renderWithMantine(
      <FilterGroup
        {...defaultProps}
        options={manyOptions}
        selectedValues={new Set(['item14', 'item13'])}
      />,
    );

    // Should show MAX_FILTER_GROUP_ITEMS (10) by default
    let options = screen.getAllByRole('checkbox');
    expect(options).toHaveLength(10);

    // Selected items should be visible even if they would be beyond MAX_FILTER_GROUP_ITEMS
    const labels = screen.getAllByText(/item13|item14/);
    expect(labels[0]).toHaveTextContent('item13');
    expect(labels[1]).toHaveTextContent('item14');

    // Click "Show more"
    const showMoreButton = screen.getByText(/Show more/);
    await userEvent.click(showMoreButton);

    // Should show all items
    options = screen.getAllByRole('checkbox');
    expect(options).toHaveLength(15);
  });

  // Type in search box (uncomment when search input is enabled)
  //   it('should filter options when searching', async () => {
  //     renderWithMantine(
  //       <FilterGroup
  //         {...defaultProps}
  //         options={[
  //           { value: 'apple123', label: 'apple123' },
  //           { value: 'apple456', label: 'apple456' },
  //           { value: 'banana', label: 'banana' },
  //         ]}
  //       />,
  //     );

  // Type in search box (uncomment when search input is enabled)
  // const searchInput = screen.getByPlaceholderText('Test Filter');
  // await userEvent.type(searchInput, 'apple');

  // const labels = screen.getAllByText(/apple123|apple456/);
  // expect(labels).toHaveLength(2);
  // expect(labels[0]).toHaveTextContent('apple123');
  // expect(labels[1]).toHaveTextContent('apple456');
  //});
});
