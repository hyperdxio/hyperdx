import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  WebhookService,
  zAlertChannels,
} from '@hyperdx/common-utils/dist/types';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { AlertChannelForm } from '@/components/Alerts';

const WEBHOOKS = [
  { _id: 'w1', name: 'Alpha Hook', service: WebhookService.Slack },
  { _id: 'w2', name: 'Beta Hook', service: WebhookService.Generic },
  { _id: 'w3', name: 'Gamma Hook', service: WebhookService.IncidentIO },
];

const AGENTS = [{ _id: 'a1', name: 'SRE Responder', model: 'claude-opus-4-8' }];

jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useWebhooks: () => ({
      data: { data: WEBHOOKS },
      refetch: jest.fn().mockResolvedValue({ data: { data: WEBHOOKS } }),
    }),
    useManagedAgents: () => ({ data: { data: AGENTS } }),
  },
}));

// The AI-agents group is gated on the deployment flag, which is off in the
// test env; enable it so agents appear among the targets.
jest.mock('@/config', () => ({
  ...jest.requireActual('@/config'),
  IS_MANAGED_AGENTS_ENABLED: true,
}));

// The creation modal pulls in the whole webhook settings form; the target
// picker's own behaviour is what's under test here. The stub exposes a button
// that reports a created webhook so handleWebhookCreated's slot-finding can be
// exercised.
jest.mock('@/components/TeamSettings/WebhookForm', () => ({
  WebhookForm: ({ onSuccess }: { onSuccess: (id?: string) => void }) => (
    <button data-testid="webhook-form-success" onClick={() => onSuccess('w2')}>
      create
    </button>
  ),
}));

type Channel =
  | { type: 'webhook'; webhookId: string }
  | { type: 'agent'; agentId: string };

type FormValues = {
  channels: Channel[];
};

// A channel type this repo doesn't render (e.g. a downstream fork's email
// channel). `value: any` (rather than an `as` cast) keeps this off the
// no-unsafe-type-assertion budget while still producing a value shaped like
// this form's channel type for the harness below.
const foreignChannel = (value: any): Channel => value;

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
  return <AlertChannelForm control={control} channelsName="channels" />;
};

// jsdom has no layout, and Mantine's combobox scrolls the active option.
beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

// The unified target picker keeps the historical select-webhook testid the
// E2E page objects target; every row (webhook or agent) renders one.
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

  it('adds and removes target rows', async () => {
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

  it('offers webhooks and AI agents as grouped options in one dropdown', async () => {
    renderWithMantine(<Harness />);

    fireEvent.click(rows()[0]);
    const listbox = await screen.findByRole('listbox');

    expect(within(listbox).getByText('Webhooks')).toBeInTheDocument();
    expect(within(listbox).getByText('AI agents')).toBeInTheDocument();
    expect(within(listbox).getByText('Alpha Hook')).toBeInTheDocument();
    expect(within(listbox).getByText('SRE Responder')).toBeInTheDocument();
  });

  it('selecting an agent makes the row an agent channel', async () => {
    renderWithMantine(<Harness />);

    fireEvent.click(rows()[0]);
    const listbox = await screen.findByRole('listbox');
    fireEvent.click(within(listbox).getByText('SRE Responder'));

    // The picker shows the chosen agent, proving the row's value flipped to
    // the agent shape (the select derives its value from the channel object).
    await waitFor(() =>
      expect(screen.getByTestId('select-webhook')).toHaveValue('SRE Responder'),
    );
  });

  it('filters by hidden type keywords, not just names', async () => {
    renderWithMantine(<Harness />);

    const input = rows()[0];
    fireEvent.click(input);

    // Mantine drops the listbox role node while a search is active, so
    // assert on the rendered options directly.
    // "slack" matches Alpha Hook via its service, not its name.
    fireEvent.change(input, { target: { value: 'slack' } });
    expect(await screen.findByText('Alpha Hook')).toBeInTheDocument();
    expect(screen.queryByText('Beta Hook')).not.toBeInTheDocument();
    expect(screen.queryByText('SRE Responder')).not.toBeInTheDocument();

    // "claude" matches the agent via its kind keywords.
    fireEvent.change(input, { target: { value: 'claude' } });
    expect(await screen.findByText('SRE Responder')).toBeInTheDocument();
    expect(screen.queryByText('Alpha Hook')).not.toBeInTheDocument();
  });

  it('disables a target already chosen by another row', async () => {
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

  it('renders nothing for a row of a type this repo does not handle, but keeps the rest of the list working', () => {
    renderWithMantine(
      <Harness
        initial={[
          foreignChannel({ type: 'email', emailRecipients: ['ops@x.test'] }),
          { type: 'webhook', webhookId: 'w1' },
        ]}
      />,
    );

    // Only the webhook row renders a target picker.
    expect(rows()).toHaveLength(1);
  });

  it('does not overwrite a configured agent row when a new webhook is created', async () => {
    renderWithMantine(<Harness initial={[{ type: 'agent', agentId: 'a1' }]} />);

    fireEvent.click(screen.getByTestId('add-new-webhook-button'));
    fireEvent.click(await screen.findByTestId('webhook-form-success'));

    // The created webhook must land in a NEW row — the agent row has an empty
    // webhookId and used to be mistaken for a free slot.
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.getByDisplayValue('SRE Responder')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Beta Hook')).toBeInTheDocument();
  });

  it('lands a created webhook in an empty webhook row when one exists', async () => {
    renderWithMantine(
      <Harness
        initial={[
          { type: 'agent', agentId: 'a1' },
          { type: 'webhook', webhookId: '' },
        ]}
      />,
    );

    fireEvent.click(screen.getByTestId('add-new-webhook-button'));
    fireEvent.click(await screen.findByTestId('webhook-form-success'));

    // Reused the existing empty webhook row rather than appending a third.
    await waitFor(() =>
      expect(screen.getByDisplayValue('Beta Hook')).toBeInTheDocument(),
    );
    expect(rows()).toHaveLength(2);
    expect(screen.getByDisplayValue('SRE Responder')).toBeInTheDocument();
  });

  // An alert with an unselected target would save a channel pointing at
  // nothing. The shared zod schema rejects it; this pins that the message
  // actually reaches the row rather than failing silently on submit.
  it('surfaces a validation error for a row with no target selected', async () => {
    const ValidatedHarness = () => {
      const { control, handleSubmit } = useForm<FormValues>({
        defaultValues: { channels: ONE_EMPTY_CHANNEL },
        resolver: zodResolver(z.object({ channels: zAlertChannels })),
      });
      return (
        <form onSubmit={handleSubmit(() => {})}>
          <AlertChannelForm control={control} channelsName="channels" />
        </form>
      );
    };
    const { container } = renderWithMantine(<ValidatedHarness />);

    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() =>
      expect(screen.getByText(/can't be empty/i)).toBeInTheDocument(),
    );
  });

  it('stops offering more targets at the cap', async () => {
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
      screen.getByText(/Limit of 10 notification targets reached/),
    ).toBeInTheDocument();
  });
});
