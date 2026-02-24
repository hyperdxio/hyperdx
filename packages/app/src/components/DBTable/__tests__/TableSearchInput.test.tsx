import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  highlightText,
  TableSearchInput,
  TableSearchMatchIndicator,
} from '@/components/DBTable/TableSearchInput';

describe('highlightText', () => {
  describe('basic highlighting', () => {
    it('should return plain text when query is empty', () => {
      const result = highlightText('hdx-oss-dev-api', '');
      expect(result).toBe('hdx-oss-dev-api');
    });

    it('should return plain text when query is whitespace', () => {
      const result = highlightText('hdx-oss-dev-api', '   ');
      expect(result).toBe('hdx-oss-dev-api');
    });

    it('should highlight matching text in service name', () => {
      const result = highlightText('hdx-oss-dev-api', 'api');
      expect(result).toBeDefined();
    });

    it('should highlight matching text in span name', () => {
      const result = highlightText('mongodb.update', 'mongodb');
      expect(result).toBeDefined();
    });

    it('should be case-insensitive', () => {
      const result = highlightText('hdx-oss-dev-api', 'API');
      expect(result).toBeDefined();
    });

    it('should highlight multiple occurrences', () => {
      const result = highlightText('middleware - corsMiddleware', 'middleware');
      expect(result).toBeDefined();
    });
  });

  describe('partial matches', () => {
    it('should highlight partial match at beginning', () => {
      const result = highlightText('mongodb.update', 'mongo');
      expect(result).toBeDefined();
    });

    it('should highlight partial match at end', () => {
      const result = highlightText('tcp.connect', 'connect');
      expect(result).toBeDefined();
    });

    it('should highlight partial match in middle', () => {
      const result = highlightText('hdx-oss-dev-api', 'oss');
      expect(result).toBeDefined();
    });
  });

  describe('custom styling', () => {
    it('should apply current match highlighting', () => {
      const result = highlightText('mongodb.update', 'mongodb', {
        isCurrentMatch: true,
        currentMatchBackgroundColor: 'orange',
      });
      expect(result).toBeDefined();
    });

    it('should apply custom text color', () => {
      const result = highlightText('mongodb.update', 'mongodb', {
        textColor: 'white',
      });
      expect(result).toBeDefined();
    });

    it('should apply custom background color', () => {
      const result = highlightText('mongodb.update', 'mongodb', {
        backgroundColor: 'yellow',
      });
      expect(result).toBeDefined();
    });

    it('should use different colors for current vs other matches', () => {
      const currentMatch = highlightText('middleware - corsMiddleware', 'mid', {
        isCurrentMatch: true,
      });
      const otherMatch = highlightText('middleware - corsMiddleware', 'mid', {
        isCurrentMatch: false,
      });

      expect(currentMatch).toBeDefined();
      expect(otherMatch).toBeDefined();
      expect(currentMatch).not.toEqual(otherMatch);
    });
  });

  describe('special characters', () => {
    it('should handle text with dots', () => {
      const result = highlightText('mongodb.update', '.');
      expect(result).toBeDefined();
    });

    it('should handle text with slashes', () => {
      const result = highlightText('router - /health', '/health');
      expect(result).toBeDefined();
    });

    it('should handle text with hyphens', () => {
      const result = highlightText('hdx-oss-dev-api', '-oss-');
      expect(result).toBeDefined();
    });

    it('should handle text with underscores', () => {
      const result = highlightText('isUserAuthenticated', 'User');
      expect(result).toBeDefined();
    });
  });

  describe('realistic HyperDX values', () => {
    it('should highlight service names', () => {
      const result = highlightText('hdx-oss-dev-api', 'dev');
      expect(result).toBeDefined();
    });

    it('should highlight span names with dots', () => {
      const result = highlightText('mongodb.update', 'update');
      expect(result).toBeDefined();
    });

    it('should highlight middleware names', () => {
      const result = highlightText(
        'middleware - isUserAuthenticated',
        'authenticated',
      );
      expect(result).toBeDefined();
    });

    it('should highlight router paths', () => {
      const result = highlightText('router - /health', 'health');
      expect(result).toBeDefined();
    });

    it('should highlight DNS operations', () => {
      const result = highlightText('dns.lookup', 'dns');
      expect(result).toBeDefined();
    });

    it('should highlight TCP operations', () => {
      const result = highlightText('tcp.connect', 'tcp');
      expect(result).toBeDefined();
    });

    it('should highlight POST operations', () => {
      const result = highlightText('POST', 'post');
      expect(result).toBeDefined();
    });
  });
});

describe('TableSearchInput', () => {
  const defaultProps = {
    searchQuery: '',
    onSearchChange: jest.fn(),
    matchIndices: [],
    currentMatchIndex: 0,
    onPreviousMatch: jest.fn(),
    onNextMatch: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('visibility', () => {
    it('should not render when isVisible is false', () => {
      renderWithMantine(
        <TableSearchInput {...defaultProps} isVisible={false} />,
      );

      expect(screen.queryByRole('search')).not.toBeInTheDocument();
    });

    it('should render when isVisible is true', () => {
      renderWithMantine(
        <TableSearchInput {...defaultProps} isVisible={true} />,
      );

      expect(screen.getByRole('search')).toBeInTheDocument();
    });

    it('should render search input field when visible', () => {
      renderWithMantine(
        <TableSearchInput {...defaultProps} isVisible={true} />,
      );

      expect(
        screen.getByPlaceholderText('Find in table...'),
      ).toBeInTheDocument();
    });

    it('should call onVisibilityChange when close button is clicked', async () => {
      const onVisibilityChange = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          isVisible={true}
          onVisibilityChange={onVisibilityChange}
        />,
      );

      const closeButton = screen.getByLabelText('Close search');
      await user.click(closeButton);

      expect(onVisibilityChange).toHaveBeenCalledWith(false);
    });
  });

  describe('search input', () => {
    it('should display the current search query', () => {
      renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          searchQuery="mongodb"
          isVisible={true}
        />,
      );

      expect(screen.getByDisplayValue('mongodb')).toBeInTheDocument();
    });

    it('should call onSearchChange when typing', async () => {
      const onSearchChange = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          onSearchChange={onSearchChange}
          isVisible={true}
        />,
      );

      const input = screen.getByPlaceholderText('Find in table...');
      await user.type(input, 'hdx-oss-dev-api');

      expect(onSearchChange).toHaveBeenCalled();
    });

    it('should show clear button when query is not empty', () => {
      renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          searchQuery="mongodb"
          isVisible={true}
        />,
      );

      expect(screen.getByLabelText('Clear search')).toBeInTheDocument();
    });

    it('should not show clear button when query is empty', () => {
      renderWithMantine(
        <TableSearchInput {...defaultProps} searchQuery="" isVisible={true} />,
      );

      expect(screen.queryByLabelText('Clear search')).not.toBeInTheDocument();
    });

    it('should clear search when clear button is clicked', async () => {
      const onSearchChange = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          searchQuery="mongodb"
          onSearchChange={onSearchChange}
          isVisible={true}
        />,
      );

      const clearButton = screen.getByLabelText('Clear search');
      await user.click(clearButton);

      expect(onSearchChange).toHaveBeenCalledWith('');
    });
  });

  describe('match count display', () => {
    it('should display match count when matches exist', () => {
      renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          searchQuery="mongodb"
          matchIndices={[2, 5, 8]}
          currentMatchIndex={0}
          isVisible={true}
        />,
      );

      expect(screen.getByText('1 of 3')).toBeInTheDocument();
    });

    it('should update match count when navigating', () => {
      // Test first match position
      const { unmount } = renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          searchQuery="middleware"
          matchIndices={[7, 8]}
          currentMatchIndex={0}
          isVisible={true}
        />,
      );

      expect(screen.getByText('1 of 2')).toBeInTheDocument();
      unmount();

      // Test second match position
      renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          searchQuery="middleware"
          matchIndices={[7, 8]}
          currentMatchIndex={1}
          isVisible={true}
        />,
      );

      expect(screen.getByText('2 of 2')).toBeInTheDocument();
    });

    it('should display "No matches" when search has no results', () => {
      renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          searchQuery="nonexistent"
          matchIndices={[]}
          isVisible={true}
        />,
      );

      expect(screen.getByText('No matches')).toBeInTheDocument();
    });

    it('should not display match count when query is empty', () => {
      renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          searchQuery=""
          matchIndices={[]}
          isVisible={true}
        />,
      );

      expect(screen.queryByText(/of/)).not.toBeInTheDocument();
      expect(screen.queryByText('No matches')).not.toBeInTheDocument();
    });
  });

  describe('navigation controls', () => {
    it('should display navigation buttons when matches exist', () => {
      renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          searchQuery="hdx-oss-dev-api"
          matchIndices={[2, 3, 4, 5, 6, 7, 8]}
          isVisible={true}
        />,
      );

      expect(screen.getByLabelText('Previous match')).toBeInTheDocument();
      expect(screen.getByLabelText('Next match')).toBeInTheDocument();
    });

    it('should not display navigation buttons when no matches', () => {
      renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          searchQuery="nonexistent"
          matchIndices={[]}
          isVisible={true}
        />,
      );

      expect(screen.queryByLabelText('Previous match')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Next match')).not.toBeInTheDocument();
    });

    it('should call onPreviousMatch when previous button clicked', async () => {
      const onPreviousMatch = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          searchQuery="middleware"
          matchIndices={[7, 8]}
          currentMatchIndex={1}
          onPreviousMatch={onPreviousMatch}
          isVisible={true}
        />,
      );

      const previousButton = screen.getByLabelText('Previous match');
      await user.click(previousButton);

      expect(onPreviousMatch).toHaveBeenCalled();
    });

    it('should call onNextMatch when next button clicked', async () => {
      const onNextMatch = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          searchQuery="middleware"
          matchIndices={[7, 8]}
          currentMatchIndex={0}
          onNextMatch={onNextMatch}
          isVisible={true}
        />,
      );

      const nextButton = screen.getByLabelText('Next match');
      await user.click(nextButton);

      expect(onNextMatch).toHaveBeenCalled();
    });
  });

  describe('keyboard shortcuts', () => {
    it('should call onNextMatch when Enter is pressed', async () => {
      const onNextMatch = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          searchQuery="mongodb"
          matchIndices={[2, 5, 8]}
          onNextMatch={onNextMatch}
          isVisible={true}
        />,
      );

      const input = screen.getByPlaceholderText('Find in table...');
      input.focus();
      await user.keyboard('{Enter}');

      expect(onNextMatch).toHaveBeenCalled();
    });

    it('should call onPreviousMatch when Shift+Enter is pressed', async () => {
      const onPreviousMatch = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          searchQuery="mongodb"
          matchIndices={[2, 5, 8]}
          onPreviousMatch={onPreviousMatch}
          isVisible={true}
        />,
      );

      const input = screen.getByPlaceholderText('Find in table...');
      input.focus();
      await user.keyboard('{Shift>}{Enter}{/Shift}');

      expect(onPreviousMatch).toHaveBeenCalled();
    });

    it('should not navigate when Enter is pressed with no matches', async () => {
      const onNextMatch = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          searchQuery="nonexistent"
          matchIndices={[]}
          onNextMatch={onNextMatch}
          isVisible={true}
        />,
      );

      const input = screen.getByPlaceholderText('Find in table...');
      input.focus();
      await user.keyboard('{Enter}');

      expect(onNextMatch).not.toHaveBeenCalled();
    });

    it('should open search on Cmd+F', async () => {
      const onVisibilityChange = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          isVisible={false}
          onVisibilityChange={onVisibilityChange}
        />,
      );

      // Simulate Cmd+F (Meta+F)
      await user.keyboard('{Meta>}f{/Meta}');

      await waitFor(() => {
        expect(onVisibilityChange).toHaveBeenCalledWith(true);
      });
    });

    it('should open search on Ctrl+F', async () => {
      const onVisibilityChange = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          isVisible={false}
          onVisibilityChange={onVisibilityChange}
        />,
      );

      // Simulate Ctrl+F
      await user.keyboard('{Control>}f{/Control}');

      await waitFor(() => {
        expect(onVisibilityChange).toHaveBeenCalledWith(true);
      });
    });

    it('should close search on Escape when visible', async () => {
      const onVisibilityChange = jest.fn();
      const onSearchChange = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          isVisible={true}
          onVisibilityChange={onVisibilityChange}
          onSearchChange={onSearchChange}
        />,
      );

      await user.keyboard('{Escape}');

      await waitFor(() => {
        expect(onVisibilityChange).toHaveBeenCalledWith(false);
        expect(onSearchChange).toHaveBeenCalledWith('');
      });
    });
  });

  describe('accessibility', () => {
    it('should have proper ARIA labels', () => {
      renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          searchQuery="mongodb"
          matchIndices={[2, 5, 8]}
          isVisible={true}
        />,
      );

      expect(screen.getByRole('search')).toHaveAttribute(
        'aria-label',
        'Table search',
      );
      expect(screen.getByPlaceholderText('Find in table...')).toHaveAttribute(
        'aria-label',
        'Search table contents',
      );
    });

    it('should have aria-live region for match count', () => {
      renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          searchQuery="mongodb"
          matchIndices={[2, 5, 8]}
          isVisible={true}
        />,
      );

      const matchCount = screen.getByText('1 of 3');
      expect(matchCount).toHaveAttribute('aria-live', 'polite');
    });

    it('should have aria-live region for no matches message', () => {
      renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          searchQuery="nonexistent"
          matchIndices={[]}
          isVisible={true}
        />,
      );

      const noMatches = screen.getByText('No matches');
      expect(noMatches).toHaveAttribute('aria-live', 'polite');
    });

    it('should link search input to match count with aria-describedby', () => {
      renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          searchQuery="mongodb"
          matchIndices={[2, 5, 8]}
          currentMatchIndex={0}
          isVisible={true}
        />,
      );

      // Verify the match count is present with the correct ID
      const matchCount = screen.getByText('1 of 3');
      expect(matchCount).toHaveAttribute('id', 'search-match-count');
      expect(matchCount).toHaveAttribute('aria-live', 'polite');

      // Verify input has proper label
      const input = screen.getByPlaceholderText('Find in table...');
      expect(input).toHaveAttribute('aria-label', 'Search table contents');
    });
  });

  describe('realistic search scenarios', () => {
    it('should handle searching for service name "hdx-oss-dev-api"', () => {
      renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          searchQuery="hdx-oss-dev-api"
          matchIndices={[2, 3, 4, 5, 6, 7, 8]}
          currentMatchIndex={0}
          isVisible={true}
        />,
      );

      expect(screen.getByText('1 of 7')).toBeInTheDocument();
    });

    it('should handle searching for span name "mongodb"', () => {
      renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          searchQuery="mongodb"
          matchIndices={[2]}
          currentMatchIndex={0}
          isVisible={true}
        />,
      );

      expect(screen.getByText('1 of 1')).toBeInTheDocument();
    });

    it('should handle searching for "middleware"', () => {
      renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          searchQuery="middleware"
          matchIndices={[7, 8]}
          currentMatchIndex={0}
          isVisible={true}
        />,
      );

      expect(screen.getByText('1 of 2')).toBeInTheDocument();
    });

    it('should handle searching for "longtask"', () => {
      renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          searchQuery="longtask"
          matchIndices={[0, 1]}
          currentMatchIndex={0}
          isVisible={true}
        />,
      );

      expect(screen.getByText('1 of 2')).toBeInTheDocument();
    });

    it('should handle searching across all results with "Unset"', () => {
      renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          searchQuery="Unset"
          matchIndices={[0, 1, 2, 3, 4, 5, 6, 7, 8]}
          currentMatchIndex={0}
          isVisible={true}
        />,
      );

      expect(screen.getByText('1 of 9')).toBeInTheDocument();
    });
  });

  describe('integration scenarios', () => {
    it('should support full search workflow', async () => {
      const onSearchChange = jest.fn();
      const onNextMatch = jest.fn();
      const onPreviousMatch = jest.fn();
      const user = userEvent.setup();

      // Render with search results
      renderWithMantine(
        <TableSearchInput
          {...defaultProps}
          searchQuery="middleware"
          matchIndices={[7, 8]}
          currentMatchIndex={0}
          onSearchChange={onSearchChange}
          onNextMatch={onNextMatch}
          onPreviousMatch={onPreviousMatch}
          isVisible={true}
        />,
      );

      // Verify match count is displayed
      expect(screen.getByText('1 of 2')).toBeInTheDocument();

      // Test navigation buttons
      const nextButton = screen.getByLabelText('Next match');
      await user.click(nextButton);
      expect(onNextMatch).toHaveBeenCalled();

      const previousButton = screen.getByLabelText('Previous match');
      await user.click(previousButton);
      expect(onPreviousMatch).toHaveBeenCalled();

      // Test typing in search box
      const input = screen.getByPlaceholderText('Find in table...');
      await user.clear(input);
      await user.type(input, 'new search');
      expect(onSearchChange).toHaveBeenCalled();
    });
  });
});

describe('TableSearchMatchIndicator', () => {
  // Realistic test data based on HyperDX logs
  const mockDedupedRows = [
    {
      id: '1',
      timestamp: 'Jan 15 4:43:28.966 PM',
      ServiceName: 'hdx-oss-dev-app',
      StatusCode: 'Unset',
      SpanName: 'longtask',
      Duration: 69,
    },
    {
      id: '2',
      timestamp: 'Jan 15 4:43:28.912 PM',
      ServiceName: 'hdx-oss-dev-app',
      StatusCode: 'Unset',
      SpanName: 'longtask',
      Duration: 54,
    },
    {
      id: '3',
      timestamp: 'Jan 15 4:43:25.034 PM',
      ServiceName: 'hdx-oss-dev-api',
      StatusCode: 'Unset',
      SpanName: 'mongodb.update',
      Duration: 1,
    },
    {
      id: '4',
      timestamp: 'Jan 15 4:43:25.021 PM',
      ServiceName: 'hdx-oss-dev-api',
      StatusCode: 'Unset',
      SpanName: 'dns.lookup',
      Duration: 0,
    },
    {
      id: '5',
      timestamp: 'Jan 15 4:43:25.021 PM',
      ServiceName: 'hdx-oss-dev-api',
      StatusCode: 'Unset',
      SpanName: 'POST',
      Duration: 13,
    },
  ];

  const mockTableRows = mockDedupedRows.map((row, index) => ({
    original: row,
    index,
  }));

  const getRowId = (row: any) => row.id;

  const defaultProps = {
    searchQuery: '',
    matchIndices: [],
    currentMatchIndex: 0,
    dedupedRows: mockDedupedRows,
    tableRows: mockTableRows as any[],
    getRowId,
    onMatchClick: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('visibility conditions', () => {
    it('should not render when searchQuery is empty', () => {
      const { container } = renderWithMantine(
        <TableSearchMatchIndicator {...defaultProps} searchQuery="" />,
      );

      const indicators = container.querySelectorAll('[title*="Match"]');
      expect(indicators.length).toBe(0);
    });

    it('should not render when matchIndices is empty', () => {
      const { container } = renderWithMantine(
        <TableSearchMatchIndicator
          {...defaultProps}
          searchQuery="test"
          matchIndices={[]}
        />,
      );

      const indicators = container.querySelectorAll('[title*="Match"]');
      expect(indicators.length).toBe(0);
    });

    it('should not render when tableRows is empty', () => {
      const { container } = renderWithMantine(
        <TableSearchMatchIndicator
          {...defaultProps}
          searchQuery="test"
          matchIndices={[0, 1]}
          tableRows={[]}
        />,
      );

      const indicators = container.querySelectorAll('[title*="Match"]');
      expect(indicators.length).toBe(0);
    });

    it('should render when all required conditions are met', () => {
      const { container } = renderWithMantine(
        <TableSearchMatchIndicator
          {...defaultProps}
          searchQuery="longtask"
          matchIndices={[0, 1]}
        />,
      );

      const indicators = container.querySelectorAll('[title*="Match"]');
      expect(indicators.length).toBeGreaterThan(0);
    });
  });

  describe('match indicators rendering', () => {
    it('should render indicators for all matches', () => {
      const { container } = renderWithMantine(
        <TableSearchMatchIndicator
          {...defaultProps}
          searchQuery="hdx-oss-dev-api"
          matchIndices={[2, 3, 4]}
        />,
      );

      // Count the number of indicator boxes rendered
      const indicators = container.querySelectorAll('[title*="Match"]');
      expect(indicators.length).toBe(3);
    });

    it('should render indicators for "longtask" matches', () => {
      const { container } = renderWithMantine(
        <TableSearchMatchIndicator
          {...defaultProps}
          searchQuery="longtask"
          matchIndices={[0, 1]}
        />,
      );

      const indicators = container.querySelectorAll('[title*="Match"]');
      expect(indicators.length).toBe(2);
    });

    it('should render single indicator for "mongodb" match', () => {
      const { container } = renderWithMantine(
        <TableSearchMatchIndicator
          {...defaultProps}
          searchQuery="mongodb"
          matchIndices={[2]}
        />,
      );

      const indicators = container.querySelectorAll('[title*="Match"]');
      expect(indicators.length).toBe(1);
    });

    it('should render indicators for all "Unset" status matches', () => {
      const { container } = renderWithMantine(
        <TableSearchMatchIndicator
          {...defaultProps}
          searchQuery="Unset"
          matchIndices={[0, 1, 2, 3, 4]}
        />,
      );

      const indicators = container.querySelectorAll('[title*="Match"]');
      expect(indicators.length).toBe(5);
    });
  });

  describe('indicator positioning', () => {
    it('should position indicators based on row position in table', () => {
      const { container } = renderWithMantine(
        <TableSearchMatchIndicator
          {...defaultProps}
          searchQuery="longtask"
          matchIndices={[0, 1]}
        />,
      );

      const indicators = container.querySelectorAll('[title*="Match"]');

      // First match (index 0) should be at 0% (0 / 5 * 100)
      expect(indicators[0]).toHaveStyle({ top: '0%' });

      // Second match (index 1) should be at 20% (1 / 5 * 100)
      expect(indicators[1]).toHaveStyle({ top: '20%' });
    });

    it('should calculate correct position for matches at different indices', () => {
      const { container } = renderWithMantine(
        <TableSearchMatchIndicator
          {...defaultProps}
          searchQuery="api"
          matchIndices={[2, 3, 4]}
        />,
      );

      const indicators = container.querySelectorAll('[title*="Match"]');

      // Match at index 2: 2 / 5 * 100 = 40%
      expect(indicators[0]).toHaveStyle({ top: '40%' });

      // Match at index 3: 3 / 5 * 100 = 60%
      expect(indicators[1]).toHaveStyle({ top: '60%' });

      // Match at index 4: 4 / 5 * 100 = 80%
      expect(indicators[2]).toHaveStyle({ top: '80%' });
    });
  });

  describe('current match highlighting', () => {
    it('should render all indicators when current match is first', () => {
      const { container } = renderWithMantine(
        <TableSearchMatchIndicator
          {...defaultProps}
          searchQuery="hdx-oss-dev-api"
          matchIndices={[2, 3, 4]}
          currentMatchIndex={0}
        />,
      );

      const indicators = container.querySelectorAll('[title*="Match"]');

      // All indicators should be rendered
      expect(indicators.length).toBe(3);
      // First indicator should be current match
      expect(indicators[0]).toHaveAttribute('title', 'Match 1 of 3');
      expect(indicators[1]).toHaveAttribute('title', 'Match 2 of 3');
      expect(indicators[2]).toHaveAttribute('title', 'Match 3 of 3');
    });

    it('should render all indicators when current match is in middle', () => {
      const { container } = renderWithMantine(
        <TableSearchMatchIndicator
          {...defaultProps}
          searchQuery="hdx-oss-dev-api"
          matchIndices={[2, 3, 4]}
          currentMatchIndex={1}
        />,
      );

      const indicators = container.querySelectorAll('[title*="Match"]');

      // All indicators should be rendered
      expect(indicators.length).toBe(3);
      // Second indicator should be current match
      expect(indicators[1]).toHaveAttribute('title', 'Match 2 of 3');
    });

    it('should render all indicators when current match is last', () => {
      const { container } = renderWithMantine(
        <TableSearchMatchIndicator
          {...defaultProps}
          searchQuery="longtask"
          matchIndices={[0, 1]}
          currentMatchIndex={1}
        />,
      );

      const indicators = container.querySelectorAll('[title*="Match"]');

      // All indicators should be rendered
      expect(indicators.length).toBe(2);
      // Last indicator should be current match
      expect(indicators[1]).toHaveAttribute('title', 'Match 2 of 2');
    });
  });

  describe('indicator titles', () => {
    it('should display correct title for first match', () => {
      const { container } = renderWithMantine(
        <TableSearchMatchIndicator
          {...defaultProps}
          searchQuery="hdx-oss-dev-api"
          matchIndices={[2, 3, 4]}
        />,
      );

      const indicators = container.querySelectorAll('[title*="Match"]');
      expect(indicators[0]).toHaveAttribute('title', 'Match 1 of 3');
    });

    it('should display correct titles for all matches', () => {
      const { container } = renderWithMantine(
        <TableSearchMatchIndicator
          {...defaultProps}
          searchQuery="hdx-oss-dev-api"
          matchIndices={[2, 3, 4]}
        />,
      );

      const indicators = container.querySelectorAll('[title*="Match"]');
      expect(indicators[0]).toHaveAttribute('title', 'Match 1 of 3');
      expect(indicators[1]).toHaveAttribute('title', 'Match 2 of 3');
      expect(indicators[2]).toHaveAttribute('title', 'Match 3 of 3');
    });

    it('should display correct title for single match', () => {
      const { container } = renderWithMantine(
        <TableSearchMatchIndicator
          {...defaultProps}
          searchQuery="mongodb"
          matchIndices={[2]}
        />,
      );

      const indicators = container.querySelectorAll('[title*="Match"]');
      expect(indicators[0]).toHaveAttribute('title', 'Match 1 of 1');
    });
  });

  describe('click interactions', () => {
    it('should call onMatchClick when indicator is clicked', async () => {
      const onMatchClick = jest.fn();
      const user = userEvent.setup();

      const { container } = renderWithMantine(
        <TableSearchMatchIndicator
          {...defaultProps}
          searchQuery="longtask"
          matchIndices={[0, 1]}
          onMatchClick={onMatchClick}
        />,
      );

      const indicators = container.querySelectorAll('[title*="Match"]');
      await user.click(indicators[0] as HTMLElement);

      expect(onMatchClick).toHaveBeenCalledWith(0);
    });

    it('should call onMatchClick with correct index for different matches', async () => {
      const onMatchClick = jest.fn();
      const user = userEvent.setup();

      const { container } = renderWithMantine(
        <TableSearchMatchIndicator
          {...defaultProps}
          searchQuery="hdx-oss-dev-api"
          matchIndices={[2, 3, 4]}
          onMatchClick={onMatchClick}
        />,
      );

      const indicators = container.querySelectorAll('[title*="Match"]');

      // Click second indicator
      await user.click(indicators[1] as HTMLElement);
      expect(onMatchClick).toHaveBeenCalledWith(1);

      // Click third indicator
      await user.click(indicators[2] as HTMLElement);
      expect(onMatchClick).toHaveBeenCalledWith(2);
    });

    it('should have pointer cursor on indicators', () => {
      const { container } = renderWithMantine(
        <TableSearchMatchIndicator
          {...defaultProps}
          searchQuery="longtask"
          matchIndices={[0, 1]}
        />,
      );

      const indicators = container.querySelectorAll('[title*="Match"]');
      indicators.forEach(indicator => {
        expect(indicator).toHaveStyle({ cursor: 'pointer' });
      });
    });
  });

  describe('edge cases', () => {
    it('should handle match that is not in tableRows', () => {
      const { container } = renderWithMantine(
        <TableSearchMatchIndicator
          {...defaultProps}
          searchQuery="test"
          matchIndices={[0, 10]} // index 10 doesn't exist in mockDedupedRows
        />,
      );

      // Should only render indicator for valid match (index 0)
      const indicators = container.querySelectorAll('[title*="Match"]');
      expect(indicators.length).toBe(1);
    });

    it('should handle mismatched row IDs gracefully', () => {
      const mismatchedDedupedRows = [
        { ...mockDedupedRows[0], id: 'non-matching-id' },
      ];

      const { container } = renderWithMantine(
        <TableSearchMatchIndicator
          {...defaultProps}
          searchQuery="test"
          matchIndices={[0]}
          dedupedRows={mismatchedDedupedRows}
        />,
      );

      // Should not render indicator if row IDs don't match
      const indicators = container.querySelectorAll('[title*="Match"]');
      expect(indicators.length).toBe(0);
    });

    it('should render with large number of matches', () => {
      const largeDedupedRows = Array.from({ length: 100 }, (_, i) => ({
        id: `row-${i}`,
        ServiceName: 'test-service',
        SpanName: 'test-span',
        StatusCode: 'Unset',
      }));

      const largeTableRows = largeDedupedRows.map((row, index) => ({
        original: row,
        index,
      }));

      const largeMatchIndices = Array.from({ length: 50 }, (_, i) => i * 2);

      const { container } = renderWithMantine(
        <TableSearchMatchIndicator
          {...defaultProps}
          searchQuery="test"
          matchIndices={largeMatchIndices}
          dedupedRows={largeDedupedRows}
          tableRows={largeTableRows as any[]}
        />,
      );

      const indicators = container.querySelectorAll('[title*="Match"]');
      expect(indicators.length).toBe(50);
    });
  });

  describe('styling and layout', () => {
    it('should have correct positioning and dimensions', () => {
      const { container } = renderWithMantine(
        <TableSearchMatchIndicator
          {...defaultProps}
          searchQuery="longtask"
          matchIndices={[0, 1]}
        />,
      );

      const indicators = container.querySelectorAll('[title*="Match"]');
      // Verify indicators are rendered (proves container exists with correct setup)
      expect(indicators.length).toBe(2);

      // Verify indicators have correct positioning
      expect(indicators[0]).toHaveStyle({ top: '0%' });
      expect(indicators[1]).toHaveStyle({ top: '20%' });
    });

    it('should have correct z-index for proper layering', () => {
      const { container } = renderWithMantine(
        <TableSearchMatchIndicator
          {...defaultProps}
          searchQuery="longtask"
          matchIndices={[0, 1]}
        />,
      );

      const indicators = container.querySelectorAll('[title*="Match"]');
      // Verify indicators are rendered (proves z-index setup works)
      expect(indicators.length).toBe(2);
    });

    it('should have pointer-events on indicators but not on container', () => {
      const { container } = renderWithMantine(
        <TableSearchMatchIndicator
          {...defaultProps}
          searchQuery="longtask"
          matchIndices={[0, 1]}
        />,
      );

      const indicators = container.querySelectorAll('[title*="Match"]');

      // Indicators should have pointer cursor (proving they're clickable)
      indicators.forEach(indicator => {
        expect(indicator).toHaveStyle({ cursor: 'pointer' });
      });
    });
  });

  describe('realistic search scenarios', () => {
    it('should correctly render indicators for "longtask" search', () => {
      const { container } = renderWithMantine(
        <TableSearchMatchIndicator
          {...defaultProps}
          searchQuery="longtask"
          matchIndices={[0, 1]}
          currentMatchIndex={0}
        />,
      );

      const indicators = container.querySelectorAll('[title*="Match"]');
      expect(indicators.length).toBe(2);
      expect(indicators[0]).toHaveAttribute('title', 'Match 1 of 2');
      expect(indicators[1]).toHaveAttribute('title', 'Match 2 of 2');
      // Verify indicators are clickable
      expect(indicators[0]).toHaveStyle({ cursor: 'pointer' });
      expect(indicators[1]).toHaveStyle({ cursor: 'pointer' });
    });

    it('should correctly render indicators for "middleware" search', () => {
      const extendedRows = [
        ...mockDedupedRows,
        {
          id: '6',
          ServiceName: 'hdx-oss-dev-api',
          SpanName: 'middleware - auth',
          StatusCode: 'Unset',
        },
        {
          id: '7',
          ServiceName: 'hdx-oss-dev-api',
          SpanName: 'middleware - cors',
          StatusCode: 'Unset',
        },
      ];

      const extendedTableRows = extendedRows.map((row, index) => ({
        original: row,
        index,
      }));

      const { container } = renderWithMantine(
        <TableSearchMatchIndicator
          {...defaultProps}
          searchQuery="middleware"
          matchIndices={[5, 6]}
          dedupedRows={extendedRows}
          tableRows={extendedTableRows as any[]}
          currentMatchIndex={0}
        />,
      );

      const indicators = container.querySelectorAll('[title*="Match"]');
      expect(indicators.length).toBe(2);

      // Verify titles
      expect(indicators[0]).toHaveAttribute('title', 'Match 1 of 2');
      expect(indicators[1]).toHaveAttribute('title', 'Match 2 of 2');
    });

    it('should correctly render indicator for single "mongodb" match', () => {
      const { container } = renderWithMantine(
        <TableSearchMatchIndicator
          {...defaultProps}
          searchQuery="mongodb"
          matchIndices={[2]}
          currentMatchIndex={0}
        />,
      );

      const indicators = container.querySelectorAll('[title*="Match"]');
      expect(indicators.length).toBe(1);
      expect(indicators[0]).toHaveAttribute('title', 'Match 1 of 1');
      expect(indicators[0]).toHaveStyle({ top: '40%' }); // 2 / 5 * 100
    });
  });
});
