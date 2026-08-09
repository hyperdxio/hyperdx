import { useForm } from 'react-hook-form';
import { WebhookService } from '@hyperdx/common-utils/dist/types';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { AlertChannelForm } from '@/components/Alerts';

const WEBHOOKS = [
  { _id: 'w1', name: 'Alpha Hook', service: WebhookService.Slack },
  { _id: 'w2', name: 'Beta Hook', service: WebhookService.Generic },
  { _id: 'w3', name: 'Gamma Hook', service: WebhookService.IncidentIO },
];

jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useWebhooks: () => ({
      data: { data: WEBHOOKS },
      refetch: jest.fn().mockResolvedValue({ data: { data: WEBHOOKS } }),
    }),
  },
}));

// The creation modal pulls in the whole webhook settings form; the channel
// picker's own behaviour is what's under test here.
jest.mock('@/components/TeamSettings/WebhookForm', () => ({
  WebhookForm: () => <div data-testid="webhook-form" />,
}));

type FormValues = {
  channels: { type: 'webhook'; webhookId: string }[];
};

const ONE_EMPTY_CHANNEL: FormValues['channels'] = [
  { type: 'webhook', webhookId: '' },
];

const Harness = ({
  initial = ONE_EMPTY_CHANNEL,
}: {
  initial?: FormValues['channels'];
}) => {
  const { control } = useForm<FormValues>({
    defaultValues: { channels: initial },
  });
  return (
    <AlertChannelForm
      control={control}
      type="webhook"
      channelsName="channels"
    />
  );
};

// jsdom has no layout, and Mantine's combobox scrolls the active option.
beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

const rows = () => screen.getAllByTestId('select-webhook');

describe('AlertChannelForm', () => {
  it('starts with a single row that cannot be removed', () => {
    renderWithMantine(<Harness />);

    expect(rows()).toHaveLength(1);
    // An alert with no target would fire into the void, so the last row stays.
    expect(
      screen.queryByTestId('remove-webhook-channel-button'),
    ).not.toBeInTheDocument();
  });

  it('adds and removes channel rows', async () => {
    renderWithMantine(<Harness />);

    fireEvent.click(screen.getByTestId('add-alert-channel-button'));
    await waitFor(() => expect(rows()).toHaveLength(2));

    // With more than one row, each becomes removable.
    const removeButtons = screen.getAllByTestId(
      'remove-webhook-channel-button',
    );
    expect(removeButtons).toHaveLength(2);

    fireEvent.click(removeButtons[0]);
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(
      screen.queryByTestId('remove-webhook-channel-button'),
    ).not.toBeInTheDocument();
  });

  it('disables a webhook already chosen by another channel', async () => {
    renderWithMantine(
      <Harness
        initial={[
          { type: 'webhook', webhookId: 'w1' },
          { type: 'webhook', webhookId: '' },
        ]}
      />,
    );

    // Open the empty row's dropdown.
    fireEvent.click(rows()[1]);

    const listbox = await screen.findByRole('listbox');
    const alpha = within(listbox).getByText('Alpha Hook');
    const beta = within(listbox).getByText('Beta Hook');

    // The API rejects duplicate channels, so the taken one must not be pickable.
    expect(alpha.closest('[data-combobox-option]')).toHaveAttribute(
      'data-combobox-disabled',
    );
    expect(beta.closest('[data-combobox-option]')).not.toHaveAttribute(
      'data-combobox-disabled',
    );
  });

  it('stops offering more channels at the cap', async () => {
    renderWithMantine(
      <Harness
        initial={Array.from({ length: 10 }, (_, i) => ({
          type: 'webhook' as const,
          webhookId: `w${i}`,
        }))}
      />,
    );

    expect(rows()).toHaveLength(10);
    expect(screen.getByTestId('add-alert-channel-button')).toBeDisabled();
    expect(
      screen.getByText(/Limit of 10 channels reached/),
    ).toBeInTheDocument();
  });
});
