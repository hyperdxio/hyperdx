import {
  AlertSource,
  AlertThresholdType,
} from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';

import { AlertDetailProperties } from '@/components/alerts/AlertDetailProperties';
import type { AlertsPageItem } from '@/types';

jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useWebhooks: () => ({
      data: {
        data: [
          { _id: 'webhook-id', name: 'Team Slack' },
          { _id: 'other-webhook', name: 'Other' },
        ],
      },
    }),
  },
}));

// Render raw ISO timestamps so time assertions don't depend on the test
// runner's timezone or the user's clock-format preference.
jest.mock('@/useFormatTime', () => ({
  FormatTime: ({ value }: { value?: number | string | Date }) =>
    value ? new Date(value).toISOString() : null,
}));

const baseAlert = {
  _id: 'alert-1',
  interval: '5m',
  threshold: 3,
  thresholdType: AlertThresholdType.ABOVE,
  source: AlertSource.SAVED_SEARCH,
  savedSearchId: 'saved-search-id',
  channel: { type: 'webhook', webhookId: 'webhook-id' },
  note: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
  history: [],
} as unknown as AlertsPageItem;

describe('AlertDetailProperties', () => {
  // `channel` is a single-value mirror of channels[0], so reading it rendered
  // a multi-channel alert as though it notified one target.
  it('reports the channel count when an alert has several', () => {
    renderWithMantine(
      <AlertDetailProperties
        alert={
          {
            ...baseAlert,
            channels: [
              { type: 'webhook', webhookId: 'webhook-id' },
              { type: 'webhook', webhookId: 'other-webhook' },
            ],
          } as unknown as AlertsPageItem
        }
      />,
    );

    expect(screen.getByText('2 channels')).toBeInTheDocument();
  });

  // One channel keeps naming its webhook — a count would be a regression for
  // the overwhelmingly common case.
  it('still names the webhook when an alert has a single channel', () => {
    renderWithMantine(
      <AlertDetailProperties
        alert={
          {
            ...baseAlert,
            channels: [{ type: 'webhook', webhookId: 'webhook-id' }],
          } as unknown as AlertsPageItem
        }
      />,
    );

    expect(screen.getByText('Team Slack')).toBeInTheDocument();
    expect(screen.queryByText('1 channels')).not.toBeInTheDocument();
  });

  it('renders all persisted metadata fields when set', () => {
    renderWithMantine(
      <AlertDetailProperties
        alert={
          {
            ...baseAlert,
            name: 'CPU alert',
            message: 'CPU is high on {{group}}',
            groupBy: 'ServiceName',
            scheduleOffsetMinutes: 3,
            silenced: {
              by: 'user@example.com',
              at: '2026-03-01T00:00:00.000Z',
              // Far future so the silence reads as active, not expired.
              until: '2099-01-01T00:00:00.000Z',
            },
            savedSearch: {
              _id: 'saved-search-id',
              name: 'My Search',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              tags: ['prod', 'payments'],
            },
          } as AlertsPageItem
        }
      />,
    );

    expect(screen.getByTestId('alert-property-name')).toHaveTextContent(
      'CPU alert',
    );
    expect(screen.getByTestId('alert-property-message')).toHaveTextContent(
      'CPU is high on {{group}}',
    );
    expect(screen.getByTestId('alert-property-group-by')).toHaveTextContent(
      'ServiceName',
    );
    expect(screen.getByTestId('alert-property-schedule')).toHaveTextContent(
      'Offset 3m into each evaluation window',
    );
    expect(screen.getByTestId('alert-property-silenced')).toHaveTextContent(
      'by user@example.com · silenced until 2099-01-01T00:00:00.000Z',
    );
    expect(screen.getByTestId('alert-property-tags')).toHaveTextContent(
      'prodpayments',
    );
    expect(screen.getByTestId('alert-property-created')).toHaveTextContent(
      '2026-01-01T00:00:00.000Z · Updated 2026-02-01T00:00:00.000Z',
    );
    // The summary line resolves the webhook id to its display name.
    expect(screen.getByText(/Team Slack/)).toBeInTheDocument();
  });

  it('omits rows for unset fields and marks expired silences', () => {
    renderWithMantine(
      <AlertDetailProperties
        alert={
          {
            ...baseAlert,
            silenced: {
              by: 'user@example.com',
              at: '2020-01-01T00:00:00.000Z',
              until: '2020-01-02T00:00:00.000Z',
            },
          } as AlertsPageItem
        }
      />,
    );

    expect(screen.queryByTestId('alert-property-name')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('alert-property-message'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('alert-property-group-by'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('alert-property-schedule'),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('alert-property-tags')).not.toBeInTheDocument();
    expect(screen.getByTestId('alert-property-silenced')).toHaveTextContent(
      'expired 2020-01-02T00:00:00.000Z',
    );
  });

  it('renders a schedule anchor when scheduleStartAt is set', () => {
    renderWithMantine(
      <AlertDetailProperties
        alert={
          {
            ...baseAlert,
            scheduleStartAt: '2026-01-15T09:00:00.000Z',
          } as AlertsPageItem
        }
      />,
    );

    expect(screen.getByTestId('alert-property-schedule')).toHaveTextContent(
      'Windows anchored at 2026-01-15T09:00:00.000Z',
    );
  });
});
