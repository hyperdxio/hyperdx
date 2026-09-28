import {
  DEFAULT_GENERIC_WEBHOOK_BODY,
  DEFAULT_INCIDENT_IO_WEBHOOK_BODY,
  WebhookService,
} from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  getWebhookTemplateVariables,
  WebhookForm,
} from '@/components/TeamSettings/WebhookForm';

const mockSaveWebhook = jest.fn();
const mockUpdateWebhook = jest.fn();

jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useSaveWebhook: () => ({ mutateAsync: mockSaveWebhook, isPending: false }),
    useUpdateWebhook: () => ({
      mutateAsync: mockUpdateWebhook,
      isPending: false,
    }),
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

function renderForm(
  webhook?: React.ComponentProps<typeof WebhookForm>['webhook'],
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MantineProvider>
        <WebhookForm
          webhook={webhook}
          onClose={jest.fn()}
          onSuccess={jest.fn()}
        />
      </MantineProvider>
    </QueryClientProvider>,
  );
}

describe('WebhookForm', () => {
  beforeEach(() => {
    mockSaveWebhook.mockReset().mockResolvedValue({ data: { _id: 'wh-1' } });
    mockUpdateWebhook.mockReset().mockResolvedValue({ data: { _id: 'wh-1' } });
  });

  it.each(['Generic', 'incident.io'])(
    'lists every template variable for a %s webhook',
    async service => {
      const user = userEvent.setup();
      renderForm();

      await user.click(screen.getByRole('radio', { name: service }));

      const variables = screen.getByTestId('webhook-template-variables');
      for (const { name } of getWebhookTemplateVariables('HyperDX')) {
        expect(variables).toHaveTextContent(name);
      }
    },
  );

  it('saves an incident.io webhook with the incident.io default body', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('radio', { name: 'incident.io' }));
    await user.type(screen.getByTestId('webhook-name-input'), 'oncall');
    await user.type(
      screen.getByTestId('webhook-url-input'),
      'https://api.incident.io/v2/alert_events/http/abc?token=xyz',
    );
    await user.click(screen.getByTestId('add-webhook-button'));

    expect(mockSaveWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ body: DEFAULT_INCIDENT_IO_WEBHOOK_BODY }),
    );
  });

  it('re-defaults an untouched body when the service changes', async () => {
    const user = userEvent.setup();
    renderForm({
      _id: 'wh-1',
      name: 'oncall',
      url: 'https://example.com/****',
      service: WebhookService.Generic,
      body: DEFAULT_GENERIC_WEBHOOK_BODY,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as React.ComponentProps<typeof WebhookForm>['webhook']);

    await user.click(screen.getByRole('radio', { name: 'incident.io' }));
    await user.click(screen.getByTestId('add-webhook-button'));

    expect(mockUpdateWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ body: DEFAULT_INCIDENT_IO_WEBHOOK_BODY }),
    );
  });

  it('does not show the template variables for a slack webhook', () => {
    renderForm();

    expect(
      screen.queryByTestId('webhook-template-variables'),
    ).not.toBeInTheDocument();
  });
});
