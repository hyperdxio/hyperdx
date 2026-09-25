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
  defaultWhere = '',
  supportsVariables,
  onSubmit,
  children,
}: {
  defaultLanguage?: 'sql' | 'lucene';
  defaultWhere?: string;
  supportsVariables?: boolean;
  onSubmit?: jest.Mock;
  children?: (props: { control: any }) => React.ReactNode;
}) {
  const form = useForm({
    defaultValues: {
      where: defaultWhere,
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
          enableVariables={supportsVariables}
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
      const { container } = renderWithMantine(
        <TestWrapper defaultLanguage="lucene" />,
      );

      // Lucene mode uses a textarea from AutocompleteInput
      const input = screen.getByPlaceholderText(
        /Search your events w\/ Lucene/i,
      );
      expect(input).toBeInTheDocument();
      // `/` and `s` still focus the input; the overlay keycap is gone.
      expect(container.querySelector('kbd')).not.toBeInTheDocument();
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

    it('does not insert a newline in Lucene when allowMultiline is false', async () => {
      const user = userEvent.setup();
      const onSubmit = jest.fn();
      renderWithMantine(
        <TestWrapper defaultLanguage="lucene">
          {({ control }) => (
            <SearchWhereInput
              tableConnection={mockTableConnection}
              control={control}
              name="where"
              allowMultiline={false}
              onSubmit={onSubmit}
            />
          )}
        </TestWrapper>,
      );

      const input = screen.getByPlaceholderText(
        /Search your events w\/ Lucene/i,
      );
      expect(input.closest('[data-single-line]')).toHaveAttribute(
        'data-single-line',
        'true',
      );
      expect(
        screen.queryByRole('button', { name: 'Keep expanded' }),
      ).not.toBeInTheDocument();
      await user.click(input);
      await user.keyboard('first{Shift>}{Enter}{/Shift}second');

      expect(input).toHaveValue('firstsecond');
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe('SQL Mode', () => {
    it('renders the SQL editor when whereLanguage is sql', () => {
      renderWithMantine(<TestWrapper defaultLanguage="sql" />);

      expect(
        screen.getByRole('combobox', { name: 'Query language' }),
      ).toHaveValue('SQL');
      expect(
        screen.queryByPlaceholderText(/Search your events w\/ Lucene/i),
      ).not.toBeInTheDocument();
    });

    it('renders SQL placeholder', () => {
      renderWithMantine(<TestWrapper defaultLanguage="sql" />);

      expect(screen.getByText(/SQL WHERE clause/i)).toBeInTheDocument();
    });
  });

  describe('Multiline display', () => {
    it.each(['lucene', 'sql'] as const)(
      'opens the %s input on focus and pins it open after blur',
      async defaultLanguage => {
        const user = userEvent.setup();
        renderWithMantine(
          <TestWrapper
            defaultLanguage={defaultLanguage}
            defaultWhere={'first line\nsecond line'}
          />,
        );

        const pin = screen.getByRole('button', { name: 'Keep expanded' });
        const root = pin.closest('[data-multiline-expanded]');
        expect(root).toHaveAttribute('data-multiline-expanded', 'false');
        expect(root).toHaveAttribute('data-multiline-pinned', 'false');

        if (defaultLanguage === 'lucene') {
          await user.click(
            screen.getByPlaceholderText(/Search your events w\/ Lucene/i),
          );
        } else {
          await user.click(
            document.querySelector('.cm-content') as HTMLElement,
          );
        }

        expect(root).toHaveAttribute('data-multiline-expanded', 'true');
        expect(root).toHaveAttribute('data-multiline-pinned', 'false');

        await user.click(pin);

        expect(
          screen.getByRole('button', { name: 'Collapse after blur' }),
        ).toHaveAttribute('aria-expanded', 'true');
        expect(root).toHaveAttribute('data-multiline-pinned', 'true');
        expect(root).toHaveAttribute('data-multiline-expanded', 'true');
      },
    );
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
      const { container } = renderWithMantine(
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

      expect(
        container.querySelector('[style*="width: 50%"]'),
      ).toBeInTheDocument();
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
          <TestWrapper defaultLanguage="lucene" supportsVariables />
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

    it('offers nothing to a field the variables do not apply to', async () => {
      // A field the renderer never substitutes must not advertise a reference
      // form that would reach ClickHouse verbatim.
      const user = userEvent.setup();
      renderWithMantine(
        <SqlVariablesProvider variables={variables}>
          <TestWrapper defaultLanguage="lucene" />
        </SqlVariablesProvider>,
      );

      await user.type(
        screen.getByPlaceholderText(/Search your events w\/ Lucene/i),
        'ServiceName:$s',
      );

      await waitFor(() =>
        expect(
          screen.queryByText('Dashboard variables'),
        ).not.toBeInTheDocument(),
      );
      expect(screen.queryByText('$svc')).not.toBeInTheDocument();
    });
  });

  describe('Variable validation', () => {
    const variables = [
      { name: 'svc', values: ['api'], expression: 'ServiceName' },
    ];

    const renderWithVariables = (
      props: React.ComponentProps<typeof TestWrapper>,
    ) =>
      renderWithMantine(
        <SqlVariablesProvider variables={variables}>
          <TestWrapper supportsVariables {...props} />
        </SqlVariablesProvider>,
      );

    /** The messages the indicator shows, or null when there is no indicator. */
    const issueMessages = () =>
      screen.queryByTestId('variable-validation')?.getAttribute('aria-label') ??
      null;

    it('warns that a SQL expression references a variable that does not exist', async () => {
      renderWithVariables({
        defaultLanguage: 'sql',
        defaultWhere: 'ServiceName IN ($srvice)',
      });

      await waitFor(() =>
        expect(issueMessages()).toBe(
          'This expression references unknown variable $srvice. Available variables: svc.',
        ),
      );
      expect(
        screen
          .getByTestId('variable-validation')
          .closest('[data-validation-state]'),
      ).toHaveAttribute('data-validation-state', 'warning');
    });

    it('warns that a Lucene expression references a variable that does not exist', async () => {
      renderWithVariables({
        defaultLanguage: 'lucene',
        defaultWhere: 'ServiceName:$srvice',
      });

      await waitFor(() =>
        expect(issueMessages()).toBe(
          'This expression references unknown variable $srvice. Available variables: svc.',
        ),
      );
      expect(
        screen
          .getByTestId('variable-validation')
          .closest('[data-validation-state]'),
      ).toHaveAttribute('data-validation-state', 'warning');
    });

    it('errors when a SQL reference is wrapped in quotes', async () => {
      renderWithVariables({
        defaultLanguage: 'sql',
        defaultWhere: "ServiceName = '$svc'",
      });

      await waitFor(() =>
        expect(issueMessages()).toContain('is wrapped in quotes'),
      );
      expect(
        screen
          .getByTestId('variable-validation')
          .closest('[data-validation-state]'),
      ).toHaveAttribute('data-validation-state', 'error');
    });

    it('leaves a quoted reference alone in Lucene, where each value is quoted anyway', async () => {
      renderWithVariables({
        defaultLanguage: 'lucene',
        defaultWhere: 'ServiceName:"$svc"',
      });

      await waitFor(() => expect(issueMessages()).toBeNull());
    });

    it('says nothing without a variable context, where nothing is substituted', async () => {
      // No provider: an expression on the search page or in a source form is
      // never substituted, so a `$name` in it is just text.
      renderWithMantine(
        <TestWrapper
          supportsVariables
          defaultLanguage="sql"
          defaultWhere="ServiceName IN ($srvice)"
        />,
      );

      await waitFor(() => expect(issueMessages()).toBeNull());
    });

    it('says nothing about a field the variables do not apply to', async () => {
      renderWithVariables({
        defaultLanguage: 'sql',
        defaultWhere: 'ServiceName IN ($srvice)',
        supportsVariables: false,
      });

      await waitFor(() => expect(issueMessages()).toBeNull());
    });

    it.each([
      // The dashboard variables feature is off, so nothing is substituted.
      ['the feature is disabled', undefined],
      // On, but no filter on this dashboard is exposed as a variable.
      ['the dashboard declares none', []],
    ])('says nothing when %s', async (_case, inScope) => {
      renderWithMantine(
        <SqlVariablesProvider variables={inScope}>
          <TestWrapper
            supportsVariables
            defaultLanguage="sql"
            defaultWhere="ServiceName IN ($srvice)"
          />
        </SqlVariablesProvider>,
      );

      await waitFor(() => expect(issueMessages()).toBeNull());
    });

    it('offers no completions when the dashboard declares none', async () => {
      // The other half of the same prop: an empty scope has nothing to suggest
      // either, so the two never disagree.
      const user = userEvent.setup();
      renderWithMantine(
        <SqlVariablesProvider variables={[]}>
          <TestWrapper supportsVariables defaultLanguage="lucene" />
        </SqlVariablesProvider>,
      );

      await user.type(
        screen.getByPlaceholderText(/Search your events w\/ Lucene/i),
        'ServiceName:$s',
      );

      await waitFor(() =>
        expect(
          screen.queryByText('Dashboard variables'),
        ).not.toBeInTheDocument(),
      );
    });
  });
});
