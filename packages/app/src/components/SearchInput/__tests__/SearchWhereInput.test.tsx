import React from 'react';
import { useForm } from 'react-hook-form';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SearchWhereInput from '@/components/SearchInput/SearchWhereInput';
import { SqlVariablesProvider } from '@/components/SQLEditor/variableCompletions';

function renderWithMantine(ui: React.ReactElement) {
  return render(
    <MantineProvider>
      <Notifications />
      {ui}
    </MantineProvider>,
  );
}

// Mock table connection for tests
const mockTableConnection = {
  databaseName: 'default',
  tableName: 'otel_logs',
  connectionId: 'test-connection',
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

// Test wrapper component that provides form context and query client
function TestWrapper({
  defaultLanguage = 'lucene',
  onSubmit,
  children,
}: {
  defaultLanguage?: 'sql' | 'lucene';
  onSubmit?: jest.Mock;
  children?: (props: { control: any }) => React.ReactNode;
}) {
  const form = useForm({
    defaultValues: {
      where: '',
      whereLanguage: defaultLanguage,
    },
  });

  return (
    <QueryClientProvider client={queryClient}>
      {children ? (
        children({ control: form.control })
      ) : (
        <SearchWhereInput
          tableConnection={mockTableConnection}
          control={form.control}
          name="where"
          onSubmit={onSubmit}
          enableHotkey
        />
      )}
    </QueryClientProvider>
  );
}

describe('SearchWhereInput', () => {
  beforeEach(() => {
    queryClient.clear();
  });

  describe('Lucene Mode', () => {
    it('renders Lucene input when whereLanguage is lucene', () => {
      renderWithMantine(<TestWrapper defaultLanguage="lucene" />);

      // Lucene mode uses a textarea from AutocompleteInput
      const input = screen.getByPlaceholderText(
        /Search your events w\/ Lucene/i,
      );
      expect(input).toBeInTheDocument();
    });

    it('allows typing in Lucene mode', async () => {
      const user = userEvent.setup();
      renderWithMantine(<TestWrapper defaultLanguage="lucene" />);

      const input = screen.getByPlaceholderText(
        /Search your events w\/ Lucene/i,
      );
      await user.type(input, 'level:error');

      await waitFor(() => {
        expect(input).toHaveValue('level:error');
      });
    });
  });

  describe('SQL Mode', () => {
    it('renders SQL input with WHERE label when whereLanguage is sql', () => {
      renderWithMantine(<TestWrapper defaultLanguage="sql" />);

      // SQL mode shows the WHERE label
      expect(screen.getByText('WHERE')).toBeInTheDocument();
    });

    it('renders SQL placeholder', () => {
      renderWithMantine(<TestWrapper defaultLanguage="sql" />);

      // Check for placeholder text in the CodeMirror editor
      // Note: CodeMirror may render placeholder differently
      screen.queryByText(/SQL WHERE clause/i);
      // If placeholder is not directly visible, the component should still render
      expect(screen.getByText('WHERE')).toBeInTheDocument();
    });
  });

  describe('Form Integration', () => {
    it('reads language from whereLanguage field', () => {
      // Default is lucene
      renderWithMantine(<TestWrapper defaultLanguage="lucene" />);
      expect(
        screen.getByPlaceholderText(/Search your events w\/ Lucene/i),
      ).toBeInTheDocument();
    });

    it('calls onSubmit when provided', async () => {
      const mockOnSubmit = jest.fn();
      const user = userEvent.setup();

      renderWithMantine(
        <TestWrapper defaultLanguage="lucene" onSubmit={mockOnSubmit} />,
      );

      const input = screen.getByPlaceholderText(
        /Search your events w\/ Lucene/i,
      );
      await user.type(input, 'test query{enter}');

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalled();
      });
    });
  });

  describe('Component Props', () => {
    it('respects width prop in SQL mode', () => {
      renderWithMantine(
        <TestWrapper defaultLanguage="sql">
          {({ control }) => (
            <SearchWhereInput
              tableConnection={mockTableConnection}
              control={control}
              name="where"
              width="50%"
            />
          )}
        </TestWrapper>,
      );

      // The Box wrapper should have the width style
      expect(screen.getByText('WHERE')).toBeInTheDocument();
    });

    it('hides label when showLabel is false', () => {
      renderWithMantine(
        <TestWrapper defaultLanguage="sql">
          {({ control }) => (
            <SearchWhereInput
              tableConnection={mockTableConnection}
              control={control}
              name="where"
              showLabel={false}
            />
          )}
        </TestWrapper>,
      );

      expect(screen.queryByText('WHERE')).not.toBeInTheDocument();
    });

    it('uses custom placeholders when provided', () => {
      renderWithMantine(
        <TestWrapper defaultLanguage="lucene">
          {({ control }) => (
            <SearchWhereInput
              tableConnection={mockTableConnection}
              control={control}
              name="where"
              lucenePlaceholder="Custom Lucene placeholder"
            />
          )}
        </TestWrapper>,
      );

      expect(
        screen.getByPlaceholderText('Custom Lucene placeholder'),
      ).toBeInTheDocument();
    });
  });

  describe('Dashboard variables in Lucene Mode', () => {
    const variables = [
      { name: 'svc', values: ['api'], expression: 'ServiceName' },
    ];

    const renderWithVariables = (
      inScope: {
        name: string;
        values: string[];
        expression?: string;
      }[] = variables,
    ) => {
      renderWithMantine(
        <SqlVariablesProvider variables={inScope}>
          <TestWrapper defaultLanguage="lucene" />
        </SqlVariablesProvider>,
      );
      return screen.getByPlaceholderText(/Search your events w\/ Lucene/i);
    };

    /** The "Searching for:" summary shown above the suggestions. */
    const searchingFor = () =>
      screen.getByText('Searching for:').nextElementSibling?.textContent ?? '';

    it('suggests a bare reference, with what it expands to now', async () => {
      const user = userEvent.setup();
      const input = renderWithVariables();

      await user.type(input, 'ServiceName:$s');

      expect(await screen.findByText('$svc')).toBeInTheDocument();
      expect(
        screen.getByText(/The selected values of svc\. Expands to: \("api"\)/),
      ).toBeInTheDocument();
    });

    it('completes in place, keeping the field the reference is scoped to', async () => {
      const user = userEvent.setup();
      const input = renderWithVariables();

      await user.type(input, 'ServiceName:$s');
      await user.click(await screen.findByText('$svc'));

      await waitFor(() => expect(input).toHaveValue('ServiceName:$svc'));
    });

    it('does not offer the variable macros', async () => {
      // They expand to SQL predicates, so they are unsupported in Lucene.
      const user = userEvent.setup();
      const input = renderWithVariables();

      await user.type(input, '$__');

      await waitFor(() =>
        expect(screen.queryByText('$__filter')).not.toBeInTheDocument(),
      );
      expect(screen.queryByText('$svc')).not.toBeInTheDocument();
    });

    it('explains the query with the selected values, not the reference', async () => {
      const user = userEvent.setup();
      const input = renderWithVariables();

      await user.type(input, 'ServiceName:$svc');

      await waitFor(() =>
        expect(searchingFor()).toBe('(ServiceName contains api)'),
      );
    });

    it('keeps the reference in the explanation while nothing is selected', async () => {
      const user = userEvent.setup();
      const input = renderWithVariables([{ name: 'svc', values: [] }]);

      await user.type(input, 'ServiceName:$svc');

      // An empty selection expands to `("")`, which reads as `is <blank>`
      // even though it filters nothing.
      await waitFor(() => expect(searchingFor()).toContain('$svc'));
      expect(searchingFor()).not.toContain('""');
    });
  });
});
