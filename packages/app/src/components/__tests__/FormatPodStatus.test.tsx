import { screen } from '@testing-library/react';

import { FormatPodStatus } from '@/components/KubeComponents';
import { KubePhase } from '@/types';

// click-ui encodes state only in hashed CSS module class names, so the mock
// exposes the prop as an attribute to assert on.
jest.mock('@clickhouse/click-ui', () => ({
  ...jest.requireActual('@clickhouse/click-ui'),
  Badge: ({ text, state }: { text: React.ReactNode; state?: string }) => (
    <span data-testid="badge" data-state={state}>
      {text}
    </span>
  ),
}));

describe('FormatPodStatus', () => {
  it.each([
    [KubePhase.Pending, 'Pending', 'warning'],
    [KubePhase.Running, 'Running', 'success'],
    [KubePhase.Succeeded, 'Succeeded', 'info'],
    [KubePhase.Failed, 'Failed', 'danger'],
    [KubePhase.Unknown, 'Unknown', 'neutral'],
    [undefined, 'Unknown', 'neutral'],
  ])('renders phase %s with the %s label', (status, label, badgeState) => {
    renderWithMantine(<FormatPodStatus status={status} />);

    const badge = screen.getByTestId('badge');
    expect(badge).toHaveTextContent(label);
    expect(badge).toHaveAttribute('data-state', badgeState);
  });
});
