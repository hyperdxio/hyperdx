import { AlertThresholdType } from '@hyperdx/common-utils/dist/types';
import { act, screen } from '@testing-library/react';

import { AlertPropertiesSummary } from '@/components/alerts/AlertPropertiesSummary';
import type { AlertsPageItem } from '@/types';

jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useWebhooks: () => ({
      data: {
        data: [
          { _id: 'hook-1', name: 'Team Slack', service: 'slack' },
          { _id: 'hook-2', name: 'Ops webhook', service: 'webhook' },
          { _id: 'hook-3', name: 'incident.io', service: 'incident_io' },
        ],
      },
    }),
  },
}));

const baseAlert = {
  _id: 'alert-1',
  interval: '5m',
  threshold: 3,
  thresholdType: AlertThresholdType.ABOVE,
  channel: { type: 'webhook', webhookId: 'hook-1' },
  note: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  history: [],
} as unknown as AlertsPageItem;

const threeChannels = {
  ...baseAlert,
  channels: [
    { type: 'webhook', webhookId: 'hook-1' },
    { type: 'webhook', webhookId: 'hook-2' },
    { type: 'webhook', webhookId: 'hook-3' },
  ],
} as AlertsPageItem;

const targets = () => screen.getByTestId('alert-notification-targets');
// The targets render as flex children, so textContent has no separating
// whitespace — the visual gaps come from the Group's gap prop.
const targetsText = () => targets().textContent;

describe('AlertPropertiesSummary notification targets', () => {
  describe('alerts-page rows', () => {
    it('shows icons only, and keeps the names in the accessibility tree', () => {
      renderWithMantine(<AlertPropertiesSummary alert={threeChannels} />);

      // The names come from a VisuallyHidden span, not inline text: the
      // three icons are what a sighted user sees.
      expect(targetsText()).toBe(
        'Notify viaTeam Slack, Ops webhook, incident.io',
      );
      expect(targets().querySelectorAll('svg')).toHaveLength(3);
    });

    it('renders one icon per target', () => {
      renderWithMantine(<AlertPropertiesSummary alert={threeChannels} />);

      expect(targets().querySelectorAll('svg')).toHaveLength(3);
    });
  });

  describe('detail page', () => {
    it('names the single target of a legacy single-channel alert', () => {
      renderWithMantine(
        <AlertPropertiesSummary alert={baseAlert} variant="detail" />,
      );

      expect(targetsText()).toBe('Notify viaTeam Slack');
    });

    it('names the targets and collapses the overflow', () => {
      renderWithMantine(
        <AlertPropertiesSummary alert={threeChannels} variant="detail" />,
      );

      expect(targetsText()).toBe('Notify viaTeam Slack,Ops webhook,+1 more');
    });

    // The overflowed names live nowhere but the tooltip, so the trigger has to
    // be focusable and has to name them itself.
    it('makes the overflow reachable without a pointer', async () => {
      renderWithMantine(
        <AlertPropertiesSummary alert={threeChannels} variant="detail" />,
      );

      const overflow = screen.getByRole('button', {
        name: '1 more: incident.io',
      });
      // Focusing now opens the tooltip, which is a state update.
      await act(async () => {
        overflow.focus();
      });
      expect(overflow).toHaveFocus();
    });

    // Rows written before multi-channel carry a null-typed channel and no
    // webhook. They must still render one generic target, not zero.
    it('renders a single generic target for a pre-multi-channel alert', () => {
      renderWithMantine(
        <AlertPropertiesSummary
          alert={
            {
              ...baseAlert,
              channel: { type: null },
              channels: undefined,
            } as unknown as AlertsPageItem
          }
          variant="detail"
        />,
      );

      expect(targetsText()).toBe('Notify viaWebhook');
    });

    it('falls back to the generic label for a deleted webhook', () => {
      renderWithMantine(
        <AlertPropertiesSummary
          alert={
            {
              ...baseAlert,
              channel: { type: 'webhook', webhookId: 'gone' },
            } as AlertsPageItem
          }
          variant="detail"
        />,
      );

      expect(targetsText()).toBe('Notify viaWebhook');
    });
  });
});
