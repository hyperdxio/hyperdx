import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import QueryLanguageSettingsForm from '@/components/TeamSettings/QueryLanguageSettingsForm';

const mockMutate = jest.fn();

jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useMe: () => ({
      data: {
        team: {
          allowedQueryLanguages: ['lucene', 'sql'],
          defaultQueryLanguage: 'lucene',
        },
      },
    }),
    useUpdateQueryLanguageSettings: () => ({
      mutate: mockMutate,
      isPending: false,
    }),
  },
}));

function renderForm() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MantineProvider>
        <QueryLanguageSettingsForm />
      </MantineProvider>
    </QueryClientProvider>,
  );
}

describe('QueryLanguageSettingsForm', () => {
  beforeEach(() => {
    mockMutate.mockReset();
  });

  it('renders current configuration and enters edit mode', async () => {
    const user = userEvent.setup();
    renderForm();

    expect(
      screen.getByText(/Query language configuration/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Lucene, SQL/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Change/i }));

    expect(screen.getByRole('checkbox', { name: 'Lucene' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'SQL' })).toBeChecked();
  });

  it('prevents unchecking all languages', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: /Change/i }));

    const luceneCheckbox = screen.getByRole('checkbox', { name: 'Lucene' });
    const sqlCheckbox = screen.getByRole('checkbox', { name: 'SQL' });

    await user.click(luceneCheckbox);
    expect(luceneCheckbox).not.toBeChecked();

    await user.click(sqlCheckbox);
    // SQL checkbox should stay checked because at least one language is required
    expect(sqlCheckbox).toBeChecked();
  });

  it('submits updated query language settings', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: /Change/i }));

    await user.click(screen.getByRole('checkbox', { name: 'Lucene' }));
    await user.click(screen.getByRole('button', { name: /Save/i }));

    expect(mockMutate).toHaveBeenCalledWith(
      {
        allowedQueryLanguages: ['sql'],
        defaultQueryLanguage: 'sql',
      },
      expect.any(Object),
    );
  });
});
