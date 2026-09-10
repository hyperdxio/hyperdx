import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  getWebhookTemplateVariables,
  WebhookForm,
} from '@/components/TeamSettings/WebhookForm';

jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useSaveWebhook: () => ({ mutateAsync: jest.fn(), isPending: false }),
    useUpdateWebhook: () => ({ mutateAsync: jest.fn(), isPending: false }),
    useTestWebhook: () => ({ mutateAsync: jest.fn(), isPending: false }),
  },
}));

// CodeMirror needs layout APIs jsdom doesn't provide.
jest.mock('@uiw/react-codemirror', () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
  }: {
    value?: string;
    onChange?: (value: string) => void;
  }) => (
    <textarea
      data-testid="codemirror"
      value={value ?? ''}
      onChange={e => onChange?.(e.target.value)}
    />
  ),
  EditorView: class {},
  placeholder: jest.fn(),
}));

function renderForm() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MantineProvider>
        <WebhookForm onClose={jest.fn()} onSuccess={jest.fn()} />
      </MantineProvider>
    </QueryClientProvider>,
  );
}

describe('WebhookForm', () => {
  it('lists every template variable for a generic webhook', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('radio', { name: 'Generic' }));

    const variables = screen.getByTestId('webhook-template-variables');
    for (const { name } of getWebhookTemplateVariables('HyperDX')) {
      expect(variables).toHaveTextContent(name);
    }
  });

  it('does not show the template variables for a slack webhook', () => {
    renderForm();

    expect(
      screen.queryByTestId('webhook-template-variables'),
    ).not.toBeInTheDocument();
  });
});
