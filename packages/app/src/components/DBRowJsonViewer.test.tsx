import React from 'react';
import { fireEvent, screen, within } from '@testing-library/react';

import { buildJSONExtractQuery, DBRowJsonViewer } from './DBRowJsonViewer';
import { RowSidePanelContext } from './DBRowSidePanel';

// Mock Next.js router
jest.mock('next/router', () => ({
  __esModule: true,
  default: {
    push: jest.fn(),
  },
}));

describe('DBRowJsonViewer', () => {
  const mockGenerateSearchUrl = jest.fn();
  const mockOnPropertyAddClick = jest.fn();
  const mockToggleColumn = jest.fn();

  const defaultContext = {
    generateSearchUrl: mockGenerateSearchUrl,
    onPropertyAddClick: mockOnPropertyAddClick,
    toggleColumn: mockToggleColumn,
    displayedColumns: [],
    generateChartUrl: jest.fn(),
  };

  // Test data with consistent structure
  const logData = {
    LogAttributes: {
      field1: 'value1',
      field2: 'value2',
      nested: {
        field3: 'nested value',
      },
    },
    Timestamp: '2024-03-14 12:34:56.789',
    TimestampTime: '2024-03-14 12:34:56.789',
  };

  const spanData = {
    SpanAttributes: {
      field1: 'value1',
      field2: 'value2',
      nested: {
        field3: 'nested value',
      },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Helper to render component
  const renderComponent = (data: any) => {
    return renderWithMantine(
      <RowSidePanelContext.Provider value={defaultContext}>
        <DBRowJsonViewer data={data} />
      </RowSidePanelContext.Provider>,
    );
  };

  // Helper to click a button on a line
  const clickLineButton = (fieldText: string, buttonText: string) => {
    const line = screen.getByText(fieldText).closest('.line')! as HTMLElement;
    fireEvent.mouseEnter(line);
    const button = within(line).getByText(buttonText);
    fireEvent.click(button);
  };

  // Helper to expand a field and click a button on a nested field
  const expandAndClickButton = (
    parentField: string,
    childField: string,
    buttonText: string,
  ) => {
    const parentLine = screen
      .getByText(parentField)
      .closest('.line')! as HTMLElement;
    fireEvent.click(parentLine);

    const childLine = screen
      .getByText(childField)
      .closest('.line')! as HTMLElement;
    fireEvent.mouseEnter(childLine);
    const button = within(childLine).getByText(buttonText);
    fireEvent.click(button);
  };

  it('formats log attributes correctly', () => {
    renderComponent(logData);
    clickLineButton('field1', 'Search');

    expect(mockGenerateSearchUrl).toHaveBeenCalledWith({
      where: "LogAttributes['field1'] = 'value1'",
      whereLanguage: 'sql',
    });
  });

  it('formats span attributes correctly', () => {
    renderComponent(spanData);
    clickLineButton('field1', 'Search');

    expect(mockGenerateSearchUrl).toHaveBeenCalledWith({
      where: "SpanAttributes['field1'] = 'value1'",
      whereLanguage: 'sql',
    });
  });

  it('handles nested paths correctly', () => {
    renderComponent(logData);
    clickLineButton('field3', 'Search');

    expect(mockGenerateSearchUrl).toHaveBeenCalledWith({
      where: "LogAttributes['nested']['field3'] = 'nested value'",
      whereLanguage: 'sql',
    });
  });

  it('handles empty attributes correctly', () => {
    renderComponent({});
    expect(screen.queryByText('Search')).toBeNull();
  });

  it('adds filters with correct path formatting', () => {
    renderComponent(logData);
    clickLineButton('field1', 'Add to Filters');

    expect(mockOnPropertyAddClick).toHaveBeenCalledWith(
      "LogAttributes['field1']",
      'value1',
    );
  });

  it('toggles columns with correct path formatting', () => {
    renderComponent(logData);
    clickLineButton('field1', 'Column');

    expect(mockToggleColumn).toHaveBeenCalledWith("LogAttributes['field1']");
  });

  describe('timestamp fields', () => {
    it.each([['Timestamp'], ['TimestampTime']])(
      'formats %s field correctly',
      field => {
        renderComponent(logData);
        clickLineButton(field, 'Search');

        expect(mockGenerateSearchUrl).toHaveBeenCalledWith({
          where: `${field} = parseDateTime64BestEffort('2024-03-14 12:34:56.789', 9)`,
          whereLanguage: 'sql',
        });
      },
    );
  });

  describe('copy functionality', () => {
    const mockClipboard = jest.fn();

    beforeEach(() => {
      Object.assign(navigator, {
        clipboard: { writeText: mockClipboard },
      });
    });

    it('copies array elements from expanded stringified JSON', () => {
      const arrayObject = { status: 'True', type: 'PodReady' };
      const data = { conditions: JSON.stringify([arrayObject]) };

      renderComponent(data);
      expandAndClickButton('conditions', '0', 'Copy Object');

      expect(mockClipboard).toHaveBeenCalledWith(
        JSON.stringify(arrayObject, null, 2),
      );
    });

    it('copies entire stringified value when not expanded', () => {
      const arrayData = [{ type: 'Ready' }, { type: 'Init' }];
      const data = { conditions: JSON.stringify(arrayData) };

      renderComponent(data);
      clickLineButton('conditions', 'Copy Value');

      expect(mockClipboard).toHaveBeenCalledWith(JSON.stringify(arrayData));
    });

    it('copies regular nested objects', () => {
      renderComponent(logData);
      clickLineButton('nested', 'Copy Object');

      expect(mockClipboard).toHaveBeenCalledWith(
        JSON.stringify({ field3: 'nested value' }, null, 2),
      );
    });
  });

  describe('buildJSONExtractQuery', () => {
    it('returns null when keyPath equals parsedJsonRootPath (no nested path)', () => {
      expect(
        buildJSONExtractQuery(['LogAttributes'], ['LogAttributes']),
      ).toBeNull();
    });

    it('returns null when keyPath is shorter than parsedJsonRootPath', () => {
      expect(buildJSONExtractQuery([], ['LogAttributes'])).toBeNull();
    });

    it('builds query for single-level path with default JSONExtractString', () => {
      expect(
        buildJSONExtractQuery(['LogAttributes', 'field1'], ['LogAttributes']),
      ).toBe("JSONExtractString(LogAttributes, 'field1')");
    });

    it('builds query for nested path', () => {
      expect(
        buildJSONExtractQuery(
          ['LogAttributes', 'nested', 'field3'],
          ['LogAttributes'],
        ),
      ).toBe("JSONExtractString(LogAttributes, 'nested', 'field3')");
    });

    it('uses JSONExtractFloat when specified', () => {
      expect(
        buildJSONExtractQuery(
          ['SpanAttributes', 'count'],
          ['SpanAttributes'],
          'JSONExtractFloat',
        ),
      ).toBe("JSONExtractFloat(SpanAttributes, 'count')");
    });

    it('uses JSONExtractBool when specified', () => {
      expect(
        buildJSONExtractQuery(
          ['LogAttributes', 'enabled'],
          ['LogAttributes'],
          'JSONExtractBool',
        ),
      ).toBe("JSONExtractBool(LogAttributes, 'enabled')");
    });

    it('handles path segments that look like array indices', () => {
      expect(
        buildJSONExtractQuery(['LogAttributes', '0', 'id'], ['LogAttributes']),
      ).toBe("JSONExtractString(LogAttributes, '0', 'id')");
    });
  });
});
