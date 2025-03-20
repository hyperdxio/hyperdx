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
    onExcludeClick: jest.fn(),
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
        selectedValues={{
          included: new Set(['zebra', 'apple']),
          excluded: new Set(),
        }}
      />,
    );

    const options = screen.getAllByRole('checkbox');
    expect(options).toHaveLength(3);
    const labels = screen.getAllByText(/apple|banana|zebra/);
    expect(labels[0]).toHaveTextContent('apple');
    expect(labels[1]).toHaveTextContent('zebra');
    expect(labels[2]).toHaveTextContent('banana');
  });

  it('should handle excluded items', () => {
    renderWithMantine(
      <FilterGroup
        {...defaultProps}
        selectedValues={{
          included: new Set(['apple']),
          excluded: new Set(['zebra']),
        }}
      />,
    );

    const options = screen.getAllByRole('checkbox');
    expect(options).toHaveLength(3);
    const labels = screen.getAllByText(/apple|banana|zebra/);
    expect(labels[0]).toHaveTextContent('apple'); // included first
    expect(labels[1]).toHaveTextContent('zebra'); // excluded second
    expect(labels[2]).toHaveTextContent('banana'); // unselected last

    // Check that zebra is marked as excluded
    const excludedCheckbox = options[1];
    expect(excludedCheckbox).toHaveAttribute('data-indeterminate', 'true');
    expect(labels[1]).toHaveStyle({ color: expect.stringContaining('red') });
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
        selectedValues={{
          included: new Set(['item14']),
          excluded: new Set(['item13']),
        }}
      />,
    );

    // Should show MAX_FILTER_GROUP_ITEMS (10) by default
    let options = screen.getAllByRole('checkbox');
    expect(options).toHaveLength(10);

    // Selected items should be visible even if they would be beyond MAX_FILTER_GROUP_ITEMS
    const labels = screen.getAllByText(/item13|item14/);
    expect(labels[0]).toHaveTextContent('item14'); // included first
    expect(labels[1]).toHaveTextContent('item13'); // excluded second

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

  //     // Type in search box (uncomment when search input is enabled)
  //     // const searchInput = screen.getByPlaceholderText('Test Filter');
  //     // await userEvent.type(searchInput, 'apple');

  //     // const labels = screen.getAllByText(/apple123|apple456/);
  //     // expect(labels).toHaveLength(2);
  //     // expect(labels[0]).toHaveTextContent('apple123');
  //     // expect(labels[1]).toHaveTextContent('apple456');
  //   });
});
