import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { NotificationDurationCell } from '@/components/alerts/NotificationDurationCell';

const analytics = {
  webhookDurationMs: 4120,
  notificationTargets: [
    {
      targetId: 'hook-1',
      target: 'Team Slack',
      durationMs: 4120,
      dispatches: 50,
      failures: 0,
    },
    {
      targetId: 'hook-2',
      target: 'Ops webhook',
      durationMs: 210,
      dispatches: 50,
      failures: 2,
    },
  ],
};

describe('NotificationDurationCell', () => {
  // Aggregation keys on the webhook id, so two webhooks sharing a display
  // name are two legitimate entries. React only complains about the duplicate
  // key through console.error, so watch for it directly.
  it('renders same-named targets as distinct rows without key collisions', () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    renderWithMantine(
      <NotificationDurationCell
        analytics={{
          webhookDurationMs: 4120,
          notificationTargets: [
            {
              targetId: 'hook-1',
              target: 'Ops webhook',
              durationMs: 4120,
              dispatches: 1,
              failures: 0,
            },
            {
              targetId: 'hook-2',
              target: 'Ops webhook',
              durationMs: 210,
              dispatches: 1,
              failures: 0,
            },
          ],
        }}
      />,
    );

    expect(screen.getAllByText('Ops webhook')).toHaveLength(2);
    // Scan every call rather than matching an argument list: React passes the
    // message as a format string plus substitutions, so a fixed-arity
    // toHaveBeenCalledWith matcher never matches and passes vacuously.
    const warnings = consoleError.mock.calls
      .map(args => args.map(String).join(' '))
      .filter(message => message.includes('same key'));
    consoleError.mockRestore();
    expect(warnings).toHaveLength(0);
  });

  it('shows a dash when the evaluation notified nothing', () => {
    renderWithMantine(<NotificationDurationCell analytics={{}} />);

    expect(screen.getByText('–')).toBeInTheDocument();
  });

  // Records written before per-target timing have the total but no breakdown.
  it('shows the total with no expander when there is no breakdown', () => {
    renderWithMantine(
      <NotificationDurationCell analytics={{ webhookDurationMs: 210 }} />,
    );

    expect(screen.getByText('210ms')).toBeInTheDocument();
    expect(
      screen.queryByTestId('notification-duration-toggle'),
    ).not.toBeInTheDocument();
  });

  // Mantine's Collapse keeps its children mounted and hides them with height,
  // so the breakdown is in the DOM either way — asserting on its content alone
  // would pass without ever clicking. aria-expanded is the part jsdom can see
  // change.
  it('toggles expansion', async () => {
    renderWithMantine(<NotificationDurationCell analytics={analytics} />);
    const toggle = screen.getByTestId('notification-duration-toggle');

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders a row per target with its own duration', () => {
    renderWithMantine(<NotificationDurationCell analytics={analytics} />);

    const breakdown = screen.getByTestId('notification-duration-breakdown');
    expect(breakdown).toHaveTextContent('Team Slack');
    expect(breakdown).toHaveTextContent('Ops webhook');
    // The slow target's own time, which the collapsed total hides behind a
    // single figure.
    expect(breakdown).toHaveTextContent('210ms');
    expect(breakdown).toHaveTextContent('2 failed');
    // Repeated dispatches are marked, so a 50-group total doesn't read as one
    // slow send.
    expect(breakdown).toHaveTextContent('×50');
  });

  // The parent row toggles its own expansion on click, so the cell's expander
  // must not bubble into it.
  it('does not propagate the toggle click to the row', async () => {
    const onRowClick = jest.fn();
    renderWithMantine(
      <div onClick={onRowClick}>
        <NotificationDurationCell analytics={analytics} />
      </div>,
    );

    await userEvent.click(screen.getByTestId('notification-duration-toggle'));

    expect(onRowClick).not.toHaveBeenCalled();
  });
});
