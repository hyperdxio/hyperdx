import { UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useGetValuesDistribution } from '@/hooks/useMetadata';

import {
  cleanedFacetName,
  FilterGroup,
  type FilterGroupProps,
} from '../DBSearchPageFilters';

jest.mock('@/hooks/useMetadata', () => ({
  useGetValuesDistribution: jest
    .fn()
    .mockReturnValue({ data: undefined, isFetching: false, error: undefined }),
}));

describe('cleanedFacetName', () => {
  describe('basic functionality', () => {
    it('should return non-toString strings unchanged', () => {
      expect(cleanedFacetName('simple.field')).toBe('simple.field');
      expect(cleanedFacetName('column_name')).toBe('column_name');
      expect(cleanedFacetName('ResourceAttributes.service.name')).toBe(
        'ResourceAttributes.service.name',
      );
    });

    it('should handle empty strings', () => {
      expect(cleanedFacetName('')).toBe('');
    });

    it('should handle strings that do not start with toString', () => {
      expect(cleanedFacetName('notToString(field)')).toBe('notToString(field)');
      expect(cleanedFacetName("JSONExtractString(data, 'field')")).toBe(
        "JSONExtractString(data, 'field')",
      );
    });
  });

  describe('JSON column cleaning', () => {
    it('should clean basic ResourceAttributes paths', () => {
      expect(
        cleanedFacetName('toString(ResourceAttributes.`service`.`name`)'),
      ).toBe('ResourceAttributes.service.name');

      expect(
        cleanedFacetName('toString(ResourceAttributes.`hdx`.`sdk`.`version`)'),
      ).toBe('ResourceAttributes.hdx.sdk.version');
    });

    it('should handle mixed quoted and unquoted ResourceAttributes', () => {
      expect(
        cleanedFacetName('toString(ResourceAttributes.`service`.name)'),
      ).toBe('ResourceAttributes.service.name');

      expect(
        cleanedFacetName('toString(ResourceAttributes.service.`name`)'),
      ).toBe('ResourceAttributes.service.name');
    });

    it('should handle deeply nested ResourceAttributes', () => {
      expect(
        cleanedFacetName(
          'toString(ResourceAttributes.`telemetry`.`sdk`.`language`)',
        ),
      ).toBe('ResourceAttributes.telemetry.sdk.language');

      expect(
        cleanedFacetName(
          'toString(ResourceAttributes.`cloud`.`provider`.`account`.`id`)',
        ),
      ).toBe('ResourceAttributes.cloud.provider.account.id');
    });

    it('should handle ResourceAttributes with special characters', () => {
      expect(
        cleanedFacetName('toString(ResourceAttributes.`service-name`)'),
      ).toBe('ResourceAttributes.service-name');

      expect(
        cleanedFacetName('toString(ResourceAttributes.`service`.`version`)'),
      ).toBe('ResourceAttributes.service.version');

      expect(
        cleanedFacetName('toString(ResourceAttributes.`k8s`.`pod`.`name`)'),
      ).toBe('ResourceAttributes.k8s.pod.name');
    });

    it('should clean basic LogAttributes paths', () => {
      expect(
        cleanedFacetName('toString(LogAttributes.`severity`.`text`)'),
      ).toBe('LogAttributes.severity.text');

      expect(cleanedFacetName('toString(LogAttributes.`level`)')).toBe(
        'LogAttributes.level',
      );
    });

    it('should handle deeply nested LogAttributes', () => {
      expect(
        cleanedFacetName('toString(LogAttributes.`context`.`user`.`id`)'),
      ).toBe('LogAttributes.context.user.id');

      expect(
        cleanedFacetName('toString(LogAttributes.`http`.`request`.`method`)'),
      ).toBe('LogAttributes.http.request.method');
    });

    it('should handle Map access in ResourceAttributes', () => {
      expect(
        cleanedFacetName(
          "ResourceAttributes['http.request.headers.user-agent']",
        ),
      ).toBe("ResourceAttributes['http.request.headers.user-agent']");
    });
  });

  describe('edge cases with Attributes', () => {
    it('should handle attributes with spaces', () => {
      expect(
        cleanedFacetName('toString(ResourceAttributes.`service name`)'),
      ).toBe('ResourceAttributes.service name');

      expect(cleanedFacetName('toString(LogAttributes.`error message`)')).toBe(
        'LogAttributes.error message',
      );
    });

    it('should handle attributes with numbers', () => {
      expect(
        cleanedFacetName('toString(ResourceAttributes.`service`.`v2`)'),
      ).toBe('ResourceAttributes.service.v2');

      expect(
        cleanedFacetName('toString(LogAttributes.`error`.`code`.`404`)'),
      ).toBe('LogAttributes.error.code.404');
    });
  });

  describe('real-world OpenTelemetry patterns', () => {
    // Common OTEL semantic conventions
    it('should handle service attributes', () => {
      expect(
        cleanedFacetName('toString(ResourceAttributes.`service`.`name`)'),
      ).toBe('ResourceAttributes.service.name');

      expect(
        cleanedFacetName('toString(ResourceAttributes.`service`.`version`)'),
      ).toBe('ResourceAttributes.service.version');

      expect(
        cleanedFacetName(
          'toString(ResourceAttributes.`service`.`instance`.`id`)',
        ),
      ).toBe('ResourceAttributes.service.instance.id');
    });

    it('should handle telemetry SDK attributes', () => {
      expect(
        cleanedFacetName(
          'toString(ResourceAttributes.`telemetry`.`sdk`.`name`)',
        ),
      ).toBe('ResourceAttributes.telemetry.sdk.name');

      expect(
        cleanedFacetName(
          'toString(ResourceAttributes.`telemetry`.`sdk`.`language`)',
        ),
      ).toBe('ResourceAttributes.telemetry.sdk.language');

      expect(
        cleanedFacetName(
          'toString(ResourceAttributes.`telemetry`.`sdk`.`version`)',
        ),
      ).toBe('ResourceAttributes.telemetry.sdk.version');
    });

    it('should handle HTTP attributes', () => {
      expect(cleanedFacetName('toString(LogAttributes.`http`.`method`)')).toBe(
        'LogAttributes.http.method',
      );

      expect(
        cleanedFacetName('toString(LogAttributes.`http`.`status_code`)'),
      ).toBe('LogAttributes.http.status_code');

      expect(cleanedFacetName('toString(LogAttributes.`http`.`url`)')).toBe(
        'LogAttributes.http.url',
      );
    });
  });
});

describe('FilterGroup', () => {
  const defaultProps: FilterGroupProps = {
    name: 'Test Filter',
    options: [
      { value: 'zebra', label: 'zebra' },
      { value: 'apple', label: 'apple' },
      { value: 'banana', label: 'banana' },
    ],
    selectedValues: { included: new Set(), excluded: new Set() },
    onChange: jest.fn(),
    onClearClick: jest.fn(),
    onOnlyClick: jest.fn(),
    onExcludeClick: jest.fn(),
    onPinClick: jest.fn(),
    isPinned: jest.fn(),
    onLoadMore: jest.fn(),
    loadMoreLoading: false,
    hasLoadedMore: false,
    isDefaultExpanded: true,
    chartConfig: {
      from: {
        databaseName: 'test_db',
        tableName: 'test_table',
      },
      select: '',
      where: '',
      whereLanguage: 'sql',
      timestampValueExpression: '',
      connection: 'test_connection',
      dateRange: [new Date('2024-01-01'), new Date('2024-01-02')],
    },
  };

  it('should sort options alphabetically by default', () => {
    renderWithMantine(<FilterGroup {...defaultProps} />);

    const options = screen.getAllByTestId(/filter-checkbox-input/g);
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

    const options = screen.getAllByTestId(/filter-checkbox-input/g);
    expect(options).toHaveLength(3);
    const labels = screen.getAllByText(/apple|banana|zebra/);
    expect(labels[0]).toHaveTextContent('apple');
    expect(labels[1]).toHaveTextContent('zebra');
    expect(labels[2]).toHaveTextContent('banana');
  });

  it('should show selected items first, then sort by counts, if percentages when they are enabled', () => {
    jest.mocked(useGetValuesDistribution).mockReturnValue({
      data: new Map([
        ['apple', 30],
        ['banana', 20],
        ['zebra', 50],
      ]),
      isFetching: false,
      error: null,
    } as UseQueryResult<Map<string, number>>);

    renderWithMantine(
      <FilterGroup
        {...defaultProps}
        selectedValues={{
          included: new Set(['banana']),
          excluded: new Set(),
        }}
      />,
    );

    const options = screen.getAllByTestId(/filter-checkbox-input/g);
    expect(options).toHaveLength(3);
    const labels = screen.getAllByText(/apple|banana|zebra/);
    expect(labels[0]).toHaveTextContent('banana'); // Selected
    expect(labels[1]).toHaveTextContent('zebra'); // 50%
    expect(labels[2]).toHaveTextContent('apple'); // 30%
  });

  it('should show percentages, if enabled', async () => {
    jest.mocked(useGetValuesDistribution).mockReturnValue({
      data: new Map([
        ['apple', 99.2],
        ['zebra', 0.6],
      ]),
      isFetching: false,
      error: null,
    } as UseQueryResult<Map<string, number>>);

    renderWithMantine(
      <FilterGroup
        {...defaultProps}
        selectedValues={{
          included: new Set(),
          excluded: new Set(),
        }}
      />,
    );

    const showPercentages = screen.getByTestId(
      'toggle-distribution-button-Test Filter',
    );
    await userEvent.click(showPercentages);

    const options = screen.getAllByTestId(/filter-checkbox-input/g);
    expect(options).toHaveLength(3);
    const labels = screen.getAllByText(/%/);
    expect(labels[0]).toHaveTextContent('~99%'); // apple
    expect(labels[1]).toHaveTextContent('<1%'); // zebra
    expect(labels[2]).toHaveTextContent('<1%'); // banana
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

    const options = screen.getAllByTestId(/filter-checkbox-input/g);
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
    let options = screen.getAllByTestId(/filter-checkbox-input/g);
    expect(options).toHaveLength(10);

    // Selected items should be visible even if they would be beyond MAX_FILTER_GROUP_ITEMS
    const labels = screen.getAllByText(/item13|item14/);
    expect(labels[0]).toHaveTextContent('item14'); // included first
    expect(labels[1]).toHaveTextContent('item13'); // excluded second

    // Click "Show more"
    const showMoreButton = screen.getByText(/Show more/);
    await userEvent.click(showMoreButton);

    // Should show all items
    options = screen.getAllByTestId(/filter-checkbox-input/g);
    expect(options).toHaveLength(15);
  });

  it('should clear excluded values when clicking Only', async () => {
    const onOnlyClick = jest.fn();
    renderWithMantine(
      <FilterGroup
        {...defaultProps}
        selectedValues={{
          included: new Set(['apple']),
          excluded: new Set(['zebra']),
        }}
        onOnlyClick={onOnlyClick}
      />,
    );

    // Find and click the "Only" button for banana
    const bananaRow = screen
      .getByText('banana')
      .closest('.filterCheckbox') as HTMLElement;
    const onlyButton = within(bananaRow).getByText('Only');
    await userEvent.click(onlyButton);

    // Verify onOnlyClick was called
    expect(onOnlyClick).toHaveBeenCalledWith('banana');
  });

  it('should filter options when searching', async () => {
    renderWithMantine(
      <FilterGroup
        {...defaultProps}
        options={[
          { value: 'apple123', label: 'apple123' },
          { value: 'apple456', label: 'apple456' },
          { value: 'banana', label: 'banana' },
        ]}
      />,
    );

    // Type in search box
    const searchInput = screen.getByPlaceholderText('Test Filter');
    await userEvent.type(searchInput, 'apple');

    const labels = screen.getAllByText(/apple123|apple456/);
    expect(labels).toHaveLength(2);
    expect(labels[0]).toHaveTextContent('apple123');
    expect(labels[1]).toHaveTextContent('apple456');

    // Verify banana is not shown
    expect(screen.queryByText('banana')).not.toBeInTheDocument();
  });

  it('Should allow opening the filter group', async () => {
    renderWithMantine(
      <FilterGroup {...defaultProps} isDefaultExpanded={false} />,
    );

    // Verify the filter group is closed
    expect(
      (await screen.findByTestId('filter-group-panel')).getAttribute(
        'aria-hidden',
      ),
    ).toBe('true');

    // Find and click the filter group header
    const header = await screen.findByTestId('filter-group-control');
    await userEvent.click(header);

    // Verify the filter group is open
    expect(
      (await screen.findByTestId('filter-group-panel')).getAttribute(
        'aria-hidden',
      ),
    ).toBe('false');
  });
});
