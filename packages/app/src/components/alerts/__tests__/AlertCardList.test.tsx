import {
  AlertState,
  AlertThresholdType,
} from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';

import { AlertCardList } from '@/components/alerts/AlertCardList';
import type { AlertsPageItem } from '@/types';

// jsdom reports every element as zero-height, so the real virtualizer would
// window the list down to an arbitrary slice. Rendering every item keeps this
// about which rows land in which section.
jest.mock('@/hooks/useVirtualList', () => ({
  useVirtualList: (count: number) => ({
    rowVirtualizer: { measureElement: () => {} },
    virtualItems: Array.from({ length: count }, (_, index) => ({
      index,
      key: index,
    })),
    paddingTop: 0,
    paddingBottom: 0,
  }),
}));

jest.mock('@/components/alerts/AlertDetails', () => ({
  AlertDetails: ({ alert }: { alert: AlertsPageItem }) => (
    <div data-testid={`alert-card-${alert._id}`} />
  ),
}));

function makeAlert(id: string, state: AlertState): AlertsPageItem {
  return {
    _id: id,
    state,
    interval: '5m',
    threshold: 3,
    thresholdType: AlertThresholdType.ABOVE,
    channel: { type: 'webhook', webhookId: 'hook-1' },
    note: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    history: [],
  } satisfies AlertsPageItem;
}

const sectionHeadings = () =>
  Array.from(document.querySelectorAll('.sectionHeader')).map(node =>
    node.textContent?.trim(),
  );

describe('AlertCardList', () => {
  it('lists alerts under their state section, in section order', () => {
    renderWithMantine(
      <AlertCardList
        alerts={[
          makeAlert('ok-1', AlertState.OK),
          makeAlert('alarm-1', AlertState.ALERT),
          makeAlert('pending-1', AlertState.PENDING),
        ]}
      />,
    );

    expect(sectionHeadings()).toEqual(['Triggered', 'Pending', 'OK']);

    const rendered = Array.from(
      document.querySelectorAll('[data-testid^="alert-card-"]'),
    ).map(node => node.getAttribute('data-testid'));
    expect(rendered).toEqual([
      'alert-card-alarm-1',
      'alert-card-pending-1',
      'alert-card-ok-1',
    ]);
  });

  it('omits empty triggered and pending sections, and shows the OK empty state', () => {
    renderWithMantine(
      <AlertCardList alerts={[makeAlert('disabled-1', AlertState.DISABLED)]} />,
    );

    expect(sectionHeadings()).toEqual(['OK']);
    expect(screen.getByText('No alerts')).toBeInTheDocument();
    // Disabled alerts belong to no section and are not listed.
    expect(
      document.querySelectorAll('[data-testid^="alert-card-"]'),
    ).toHaveLength(0);
  });
});
