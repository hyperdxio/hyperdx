import { fireEvent, screen, within } from '@testing-library/react';

import { DBRowJsonViewer } from './DBRowJsonViewer';
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

  // Helper function to simulate clicking a button in a line
  const clickLineButton = (fieldText: string, buttonText: string) => {
    const line = screen.getByText(fieldText).closest('.line')! as HTMLElement;
    fireEvent.mouseEnter(line);
    const lineMenu = line.querySelector('.lineMenu')! as HTMLElement;
    const button = within(lineMenu).getByText(buttonText);
    fireEvent.click(button);
  };

  // Helper to render component
  const renderComponent = (data: any) => {
    return renderWithMantine(
      <RowSidePanelContext.Provider value={defaultContext}>
        <DBRowJsonViewer data={data} />
      </RowSidePanelContext.Provider>,
    );
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
});
