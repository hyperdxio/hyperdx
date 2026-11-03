import { AlertState } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';

import { AlertStateBadge } from '@/components/alerts/AlertStateBadge';

// click-ui encodes state and type only in hashed CSS module class names, so
// the mock exposes the props as attributes to assert on.
jest.mock('@clickhouse/click-ui', () => ({
  ...jest.requireActual('@clickhouse/click-ui'),
  Badge: ({
    text,
    state,
    type,
  }: {
    text: React.ReactNode;
    state?: string;
    type?: string;
  }) => (
    <span data-testid="badge" data-state={state} data-type={type}>
      {text}
    </span>
  ),
}));

describe('AlertStateBadge', () => {
  it.each([
    [AlertState.ALERT, 'Alert', 'danger', 'solid'],
    [AlertState.PENDING, 'Pending', 'warning', undefined],
    [AlertState.ERROR, 'Error', 'danger', undefined],
    [AlertState.OK, 'Ok', 'success', undefined],
    [AlertState.DISABLED, 'Disabled', 'neutral', undefined],
    [AlertState.INSUFFICIENT_DATA, 'No data', 'neutral', undefined],
  ])('renders %s with the %s label', (state, label, badgeState, badgeType) => {
    renderWithMantine(<AlertStateBadge state={state} />);

    const badge = screen.getByTestId('badge');
    expect(badge).toHaveTextContent(label);
    expect(badge).toHaveAttribute('data-state', badgeState);
    if (badgeType) {
      expect(badge).toHaveAttribute('data-type', badgeType);
    } else {
      expect(badge).not.toHaveAttribute('data-type');
    }
  });
});
