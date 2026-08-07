import { ReactNode } from 'react';
import { MantineProvider } from '@mantine/core';
import {
  fireEvent,
  render,
  screen,
  waitForElementToBeRemoved,
} from '@testing-library/react';

import { VIEW_TRACE_CALLOUT_DISMISSED_KEY } from '@/components/viewTraceCallout';
import { ViewTraceCalloutButton } from '@/components/ViewTraceCalloutButton';

// Wrap in a provider that is reapplied on rerender, so transitions of the
// `disabled` prop (row navigation) can be exercised.
function MantineWrapper({ children }: { children: ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

describe('ViewTraceCalloutButton', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('shows the one-time callout when enabled and not yet dismissed', () => {
    renderWithMantine(
      <ViewTraceCalloutButton disabled={false} onView={jest.fn()} />,
    );

    expect(screen.getByTestId('side-panel-view-trace')).toBeEnabled();
    expect(screen.getByTestId('view-trace-callout')).toBeInTheDocument();
    expect(screen.getByText('Got it')).toBeInTheDocument();
  });

  it('does not open the callout while the trace is unresolved (disabled)', () => {
    renderWithMantine(<ViewTraceCalloutButton disabled onView={jest.fn()} />);

    expect(screen.getByTestId('side-panel-view-trace')).toBeDisabled();
    expect(screen.queryByTestId('view-trace-callout')).not.toBeInTheDocument();
  });

  it('does not show the callout once it has been dismissed previously', () => {
    window.localStorage.setItem(
      VIEW_TRACE_CALLOUT_DISMISSED_KEY,
      JSON.stringify(true),
    );

    renderWithMantine(
      <ViewTraceCalloutButton disabled={false} onView={jest.fn()} />,
    );

    // Button still available, but the nudge no longer appears.
    expect(screen.getByTestId('side-panel-view-trace')).toBeInTheDocument();
    expect(screen.queryByTestId('view-trace-callout')).not.toBeInTheDocument();
  });

  it('persists dismissal and navigates when the View Trace button is clicked', async () => {
    const onView = jest.fn();
    renderWithMantine(
      <ViewTraceCalloutButton disabled={false} onView={onView} />,
    );

    fireEvent.click(screen.getByTestId('side-panel-view-trace'));

    expect(onView).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(VIEW_TRACE_CALLOUT_DISMISSED_KEY)).toBe(
      JSON.stringify(true),
    );
    // The popover plays an exit transition before unmounting.
    await waitForElementToBeRemoved(() =>
      screen.queryByTestId('view-trace-callout'),
    );
  });

  it('persists dismissal without navigating when "Got it" is clicked', async () => {
    const onView = jest.fn();
    renderWithMantine(
      <ViewTraceCalloutButton disabled={false} onView={onView} />,
    );

    fireEvent.click(screen.getByText('Got it'));

    expect(onView).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(VIEW_TRACE_CALLOUT_DISMISSED_KEY)).toBe(
      JSON.stringify(true),
    );
    await waitForElementToBeRemoved(() =>
      screen.queryByTestId('view-trace-callout'),
    );
  });

  it('opens the callout once the trace resolves (disabled → enabled)', async () => {
    const { rerender } = render(
      <ViewTraceCalloutButton disabled onView={jest.fn()} />,
      { wrapper: MantineWrapper },
    );

    expect(screen.queryByTestId('view-trace-callout')).not.toBeInTheDocument();

    rerender(<ViewTraceCalloutButton disabled={false} onView={jest.fn()} />);

    // The popover mounts its dropdown via an enter transition (async).
    expect(await screen.findByTestId('view-trace-callout')).toBeInTheDocument();
  });

  it('stays open across row navigation when disabled briefly flips back to true', () => {
    // The side panel is reused as the user pages between rows, so `disabled`
    // momentarily returns to true while each new row's trace re-resolves.
    // The nudge must not close and re-open on every row.
    const { rerender } = render(
      <ViewTraceCalloutButton disabled={false} onView={jest.fn()} />,
      { wrapper: MantineWrapper },
    );

    expect(screen.getByTestId('view-trace-callout')).toBeInTheDocument();

    // Navigate to another row: trace re-resolves (disabled true), then settles.
    rerender(<ViewTraceCalloutButton disabled onView={jest.fn()} />);
    expect(screen.getByTestId('view-trace-callout')).toBeInTheDocument();

    rerender(<ViewTraceCalloutButton disabled={false} onView={jest.fn()} />);
    expect(screen.getByTestId('view-trace-callout')).toBeInTheDocument();
  });
});
