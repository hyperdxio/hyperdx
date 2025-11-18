import { UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useGetValuesDistribution } from '@/hooks/useMetadata';

import {
  FilterGroup,
  type FilterGroupProps,
  groupFacetsByMapType,
  parseMapExpression,
  toDisplayFormat,
} from '../DBSearchPageFilters';

jest.mock('@/hooks/useMetadata', () => ({
  useGetValuesDistribution: jest
    .fn()
    .mockReturnValue({ data: undefined, isFetching: false, error: undefined }),
}));

describe('toDisplayFormat', () => {
  describe('basic functionality', () => {
    it('should return non-toString strings unchanged', () => {
      expect(toDisplayFormat('simple.field')).toBe('simple.field');
      expect(toDisplayFormat('column_name')).toBe('column_name');
      expect(toDisplayFormat('ResourceAttributes.service.name')).toBe(
        'ResourceAttributes.service.name',
      );
    });

    it('should handle empty strings', () => {
      expect(toDisplayFormat('')).toBe('');
    });

    it('should handle strings that do not start with toString', () => {
      expect(toDisplayFormat('notToString(field)')).toBe('notToString(field)');
      expect(toDisplayFormat("JSONExtractString(data, 'field')")).toBe(
        "JSONExtractString(data, 'field')",
      );
    });
  });

  describe('JSON column cleaning', () => {
    it('should clean basic ResourceAttributes paths', () => {
      expect(
        toDisplayFormat('toString(ResourceAttributes.`service`.`name`)'),
      ).toBe('ResourceAttributes.service.name');

      expect(
        toDisplayFormat('toString(ResourceAttributes.`hdx`.`sdk`.`version`)'),
      ).toBe('ResourceAttributes.hdx.sdk.version');
    });

    it('should handle mixed quoted and unquoted ResourceAttributes', () => {
      expect(
        toDisplayFormat('toString(ResourceAttributes.`service`.name)'),
      ).toBe('ResourceAttributes.service.name');

      expect(
        toDisplayFormat('toString(ResourceAttributes.service.`name`)'),
      ).toBe('ResourceAttributes.service.name');
    });

    it('should handle deeply nested ResourceAttributes', () => {
      expect(
        toDisplayFormat(
          'toString(ResourceAttributes.`telemetry`.`sdk`.`language`)',
        ),
      ).toBe('ResourceAttributes.telemetry.sdk.language');

      expect(
        toDisplayFormat(
          'toString(ResourceAttributes.`cloud`.`provider`.`account`.`id`)',
        ),
      ).toBe('ResourceAttributes.cloud.provider.account.id');
    });

    it('should handle ResourceAttributes with special characters', () => {
      expect(
        toDisplayFormat('toString(ResourceAttributes.`service-name`)'),
      ).toBe('ResourceAttributes.service-name');

      expect(
        toDisplayFormat('toString(ResourceAttributes.`service`.`version`)'),
      ).toBe('ResourceAttributes.service.version');

      expect(
        toDisplayFormat('toString(ResourceAttributes.`k8s`.`pod`.`name`)'),
      ).toBe('ResourceAttributes.k8s.pod.name');
    });

    it('should clean basic LogAttributes paths', () => {
      expect(toDisplayFormat('toString(LogAttributes.`severity`.`text`)')).toBe(
        'LogAttributes.severity.text',
      );

      expect(toDisplayFormat('toString(LogAttributes.`level`)')).toBe(
        'LogAttributes.level',
      );
    });

    it('should handle deeply nested LogAttributes', () => {
      expect(
        toDisplayFormat('toString(LogAttributes.`context`.`user`.`id`)'),
      ).toBe('LogAttributes.context.user.id');

      expect(
        toDisplayFormat('toString(LogAttributes.`http`.`request`.`method`)'),
      ).toBe('LogAttributes.http.request.method');
    });

    it('should handle Map access in ResourceAttributes', () => {
      expect(
        toDisplayFormat(
          "ResourceAttributes['http.request.headers.user-agent']",
        ),
      ).toBe("ResourceAttributes['http.request.headers.user-agent']");
    });
  });

  describe('edge cases with Attributes', () => {
    it('should handle attributes with spaces', () => {
      expect(
        toDisplayFormat('toString(ResourceAttributes.`service name`)'),
      ).toBe('ResourceAttributes.service name');

      expect(toDisplayFormat('toString(LogAttributes.`error message`)')).toBe(
        'LogAttributes.error message',
      );
    });

    it('should handle attributes with numbers', () => {
      expect(
        toDisplayFormat('toString(ResourceAttributes.`service`.`v2`)'),
      ).toBe('ResourceAttributes.service.v2');

      expect(
        toDisplayFormat('toString(LogAttributes.`error`.`code`.`404`)'),
      ).toBe('LogAttributes.error.code.404');
    });
  });

  describe('real-world OpenTelemetry patterns', () => {
    // Common OTEL semantic conventions
    it('should handle service attributes', () => {
      expect(
        toDisplayFormat('toString(ResourceAttributes.`service`.`name`)'),
      ).toBe('ResourceAttributes.service.name');

      expect(
        toDisplayFormat('toString(ResourceAttributes.`service`.`version`)'),
      ).toBe('ResourceAttributes.service.version');

      expect(
        toDisplayFormat(
          'toString(ResourceAttributes.`service`.`instance`.`id`)',
        ),
      ).toBe('ResourceAttributes.service.instance.id');
    });

    it('should handle telemetry SDK attributes', () => {
      expect(
        toDisplayFormat(
          'toString(ResourceAttributes.`telemetry`.`sdk`.`name`)',
        ),
      ).toBe('ResourceAttributes.telemetry.sdk.name');

      expect(
        toDisplayFormat(
          'toString(ResourceAttributes.`telemetry`.`sdk`.`language`)',
        ),
      ).toBe('ResourceAttributes.telemetry.sdk.language');

      expect(
        toDisplayFormat(
          'toString(ResourceAttributes.`telemetry`.`sdk`.`version`)',
        ),
      ).toBe('ResourceAttributes.telemetry.sdk.version');
    });

    it('should handle HTTP attributes', () => {
      expect(toDisplayFormat('toString(LogAttributes.`http`.`method`)')).toBe(
        'LogAttributes.http.method',
      );

      expect(
        toDisplayFormat('toString(LogAttributes.`http`.`status_code`)'),
      ).toBe('LogAttributes.http.status_code');

      expect(toDisplayFormat('toString(LogAttributes.`http`.`url`)')).toBe(
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

    const options = screen.getAllByTestId(/filter-checkbox-input/);
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

    const options = screen.getAllByTestId(/filter-checkbox-input/);
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

    const options = screen.getAllByTestId(/filter-checkbox-input/);
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

    const options = screen.getAllByTestId(/filter-checkbox-input/);
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

    const options = screen.getAllByTestId(/filter-checkbox-input/);
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
    let options = screen.getAllByTestId(/filter-checkbox-input/);
    expect(options).toHaveLength(10);

    // Selected items should be visible even if they would be beyond MAX_FILTER_GROUP_ITEMS
    const labels = screen.getAllByText(/item13|item14/);
    expect(labels[0]).toHaveTextContent('item14'); // included first
    expect(labels[1]).toHaveTextContent('item13'); // excluded second

    // Click "Show more"
    const showMoreButton = screen.getByText(/Show more/);
    await userEvent.click(showMoreButton);

    // Should show all items
    options = screen.getAllByTestId(/filter-checkbox-input/);
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
          { value: 'cherry', label: 'cherry' },
          { value: 'date', label: 'date' },
          { value: 'elderberry', label: 'elderberry' },
        ]}
      />,
    );

    // Type in search box (should appear because we have >5 items)
    const searchInput = screen.getByTestId('filter-search-Test Filter');
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

describe('parseMapExpression', () => {
  describe('Map type expressions', () => {
    it('should parse single-quoted map properties', () => {
      const result = parseMapExpression("ResourceAttributes['host.name']");
      expect(result).toEqual({
        isMapType: true,
        mapName: 'ResourceAttributes',
        propertyName: 'host.name',
        fullKey: "ResourceAttributes['host.name']",
      });
    });

    it('should parse double-quoted map properties', () => {
      const result = parseMapExpression('ResourceAttributes["host.name"]');
      expect(result).toEqual({
        isMapType: true,
        mapName: 'ResourceAttributes',
        propertyName: 'host.name',
        fullKey: 'ResourceAttributes["host.name"]',
      });
    });

    it('should parse nested map properties', () => {
      const result = parseMapExpression(
        "LogProperties['mymap']['mymap2']['property']",
      );
      expect(result).toEqual({
        isMapType: true,
        mapName: 'LogProperties',
        propertyName: 'mymap.mymap2.property',
        fullKey: "LogProperties['mymap']['mymap2']['property']",
      });
    });

    it('should handle mixed quotes in nested properties', () => {
      const result = parseMapExpression(
        'ResourceAttributes["service"]["name"]',
      );
      expect(result).toEqual({
        isMapType: true,
        mapName: 'ResourceAttributes',
        propertyName: 'service.name',
        fullKey: 'ResourceAttributes["service"]["name"]',
      });
    });

    it('should handle properties with dots in the name', () => {
      const result = parseMapExpression("ResourceAttributes['service.name']");
      expect(result).toEqual({
        isMapType: true,
        mapName: 'ResourceAttributes',
        propertyName: 'service.name',
        fullKey: "ResourceAttributes['service.name']",
      });
    });
  });

  describe('JSON toString expressions', () => {
    it('should parse toString with single nested property', () => {
      const result = parseMapExpression(
        'toString(ResourceAttributes.`service`)',
      );
      expect(result).toEqual({
        isMapType: true,
        mapName: 'ResourceAttributes',
        propertyName: 'service',
        fullKey: 'toString(ResourceAttributes.`service`)',
      });
    });

    it('should parse toString with deeply nested properties', () => {
      const result = parseMapExpression(
        'toString(ResourceAttributes.`hdx`.`sdk`.`version`)',
      );
      expect(result).toEqual({
        isMapType: true,
        mapName: 'ResourceAttributes',
        propertyName: 'hdx.sdk.version',
        fullKey: 'toString(ResourceAttributes.`hdx`.`sdk`.`version`)',
      });
    });

    it('should parse toString without backticks', () => {
      const result = parseMapExpression('toString(ResourceAttributes.service)');
      expect(result).toEqual({
        isMapType: true,
        mapName: 'ResourceAttributes',
        propertyName: 'service',
        fullKey: 'toString(ResourceAttributes.service)',
      });
    });

    it('should parse toString with mixed backtick usage', () => {
      const result = parseMapExpression(
        'toString(ResourceAttributes.`service`.name.`version`)',
      );
      expect(result).toEqual({
        isMapType: true,
        mapName: 'ResourceAttributes',
        propertyName: 'service.name.version',
        fullKey: 'toString(ResourceAttributes.`service`.name.`version`)',
      });
    });
  });

  describe('Edge cases and malformed input', () => {
    it('should return non-map type for regular field names', () => {
      const result = parseMapExpression('simple_field');
      expect(result).toEqual({
        isMapType: false,
        fullKey: 'simple_field',
      });
    });

    it('should return non-map type for dotted field names', () => {
      const result = parseMapExpression('service.name');
      expect(result).toEqual({
        isMapType: false,
        fullKey: 'service.name',
      });
    });

    it('should handle empty string', () => {
      const result = parseMapExpression('');
      expect(result).toEqual({
        isMapType: false,
        fullKey: '',
      });
    });

    it('should handle malformed map expression with empty brackets', () => {
      const result = parseMapExpression("ResourceAttributes['']");
      // Empty brackets result in empty string which is filtered out by .filter(Boolean)
      expect(result).toEqual({
        isMapType: false,
        fullKey: "ResourceAttributes['']",
      });
    });

    it('should handle malformed map expression with unclosed bracket', () => {
      const result = parseMapExpression("ResourceAttributes['property");
      // Unclosed bracket still gets parsed, extracts "'property" (with leading quote)
      expect(result).toEqual({
        isMapType: true,
        mapName: 'ResourceAttributes',
        propertyName: "'property",
        fullKey: "ResourceAttributes['property",
      });
    });

    it('should handle malformed map expression with no opening bracket', () => {
      const result = parseMapExpression("ResourceAttributesproperty']");
      expect(result).toEqual({
        isMapType: false,
        fullKey: "ResourceAttributesproperty']",
      });
    });

    it('should handle map expression without quotes', () => {
      const result = parseMapExpression('ResourceAttributes[property]');
      expect(result).toEqual({
        isMapType: true,
        mapName: 'ResourceAttributes',
        propertyName: 'property',
        fullKey: 'ResourceAttributes[property]',
      });
    });

    it('should handle toString without closing parenthesis', () => {
      const result = parseMapExpression('toString(ResourceAttributes.service');
      expect(result).toEqual({
        isMapType: false,
        fullKey: 'toString(ResourceAttributes.service',
      });
    });

    it('should handle toString without dot', () => {
      const result = parseMapExpression('toString(ResourceAttributes)');
      expect(result).toEqual({
        isMapType: false,
        fullKey: 'toString(ResourceAttributes)',
      });
    });

    it('should handle single character in brackets', () => {
      const result = parseMapExpression("ResourceAttributes['a']");
      expect(result).toEqual({
        isMapType: true,
        mapName: 'ResourceAttributes',
        propertyName: 'a',
        fullKey: "ResourceAttributes['a']",
      });
    });

    it('should handle mismatched quotes', () => {
      const result = parseMapExpression('ResourceAttributes["property\']');
      expect(result).toEqual({
        isMapType: true,
        mapName: 'ResourceAttributes',
        propertyName: '"property\'',
        fullKey: 'ResourceAttributes["property\']',
      });
    });
  });
});

describe('groupFacetsByMapType', () => {
  it('should separate map and regular facets', () => {
    const facets = [
      { key: "ResourceAttributes['host.name']", value: ['host1', 'host2'] },
      { key: 'severity', value: ['info', 'error'] },
      { key: "LogAttributes['user.id']", value: ['123', '456'] },
      { key: 'level', value: ['1', '2'] },
    ];

    const result = groupFacetsByMapType(facets);

    expect(result.regularFacets).toEqual([
      { key: 'severity', value: ['info', 'error'] },
      { key: 'level', value: ['1', '2'] },
    ]);

    expect(result.mapGroups.size).toBe(2);
    expect(result.mapGroups.get('ResourceAttributes')).toEqual([
      { key: "ResourceAttributes['host.name']", value: ['host1', 'host2'] },
    ]);
    expect(result.mapGroups.get('LogAttributes')).toEqual([
      { key: "LogAttributes['user.id']", value: ['123', '456'] },
    ]);
  });

  it('should group multiple properties from same map', () => {
    const facets = [
      { key: "ResourceAttributes['host.name']", value: ['host1'] },
      { key: "ResourceAttributes['service.name']", value: ['api'] },
      { key: "ResourceAttributes['os.type']", value: ['linux'] },
    ];

    const result = groupFacetsByMapType(facets);

    expect(result.regularFacets).toEqual([]);
    expect(result.mapGroups.size).toBe(1);
    expect(result.mapGroups.get('ResourceAttributes')).toHaveLength(3);
  });

  it('should handle nested map properties', () => {
    const facets = [
      {
        key: "LogProperties['nested']['deep']['property']",
        value: ['value1'],
      },
      { key: "LogProperties['another']", value: ['value2'] },
    ];

    const result = groupFacetsByMapType(facets);

    expect(result.mapGroups.get('LogProperties')).toHaveLength(2);
  });

  it('should handle toString expressions', () => {
    const facets = [
      {
        key: 'toString(ResourceAttributes.`service`.`name`)',
        value: ['api'],
      },
      { key: 'toString(ResourceAttributes.`host`)', value: ['localhost'] },
    ];

    const result = groupFacetsByMapType(facets);

    expect(result.mapGroups.get('ResourceAttributes')).toHaveLength(2);
  });

  it('should handle mixed map types and regular fields', () => {
    const facets = [
      { key: 'severity', value: ['info'] },
      { key: "ResourceAttributes['host']", value: ['host1'] },
      { key: 'toString(LogAttributes.`user`)', value: ['user1'] },
      { key: 'level', value: ['1'] },
      { key: "SpanAttributes['trace.id']", value: ['trace1'] },
    ];

    const result = groupFacetsByMapType(facets);

    expect(result.regularFacets).toHaveLength(2);
    expect(result.mapGroups.size).toBe(3);
    expect(result.mapGroups.has('ResourceAttributes')).toBe(true);
    expect(result.mapGroups.has('LogAttributes')).toBe(true);
    expect(result.mapGroups.has('SpanAttributes')).toBe(true);
  });

  it('should handle empty facets array', () => {
    const result = groupFacetsByMapType([]);

    expect(result.regularFacets).toEqual([]);
    expect(result.mapGroups.size).toBe(0);
  });

  it('should handle all regular facets (no map types)', () => {
    const facets = [
      { key: 'severity', value: ['info'] },
      { key: 'level', value: ['1'] },
      { key: 'status', value: ['ok'] },
    ];

    const result = groupFacetsByMapType(facets);

    expect(result.regularFacets).toHaveLength(3);
    expect(result.mapGroups.size).toBe(0);
  });

  it('should handle all map facets (no regular fields)', () => {
    const facets = [
      { key: "ResourceAttributes['host']", value: ['host1'] },
      { key: "ResourceAttributes['service']", value: ['api'] },
      { key: "LogAttributes['user']", value: ['user1'] },
    ];

    const result = groupFacetsByMapType(facets);

    expect(result.regularFacets).toEqual([]);
    expect(result.mapGroups.size).toBe(2);
  });

  it('should preserve facet value arrays', () => {
    const facets = [
      {
        key: "ResourceAttributes['host']",
        value: ['host1', 'host2', 'host3'],
      },
    ];

    const result = groupFacetsByMapType(facets);

    expect(result.mapGroups.get('ResourceAttributes')?.[0].value).toEqual([
      'host1',
      'host2',
      'host3',
    ]);
  });

  it('should handle malformed map expressions', () => {
    const facets = [
      { key: "ResourceAttributes['unclosed", value: ['value1'] },
      { key: 'ResourceAttributes]wrong[', value: ['value2'] },
      { key: 'toString(NoProperty)', value: ['value3'] },
    ];

    const result = groupFacetsByMapType(facets);

    // Unclosed bracket still gets parsed as map type
    expect(result.mapGroups.get('ResourceAttributes')).toHaveLength(1);
    // Other malformed expressions are treated as regular facets
    expect(result.regularFacets).toHaveLength(2);
    expect(result.regularFacets[0].key).toBe('ResourceAttributes]wrong[');
    expect(result.regularFacets[1].key).toBe('toString(NoProperty)');
  });
});
