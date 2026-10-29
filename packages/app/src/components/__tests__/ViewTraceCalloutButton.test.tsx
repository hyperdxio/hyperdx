import { ReactNode, useState } from 'react';
import { MantineProvider } from '@mantine/core';
import {
  fireEvent,
  render,
  screen,
  waitForElementToBeRemoved,
} from '@testing-library/react';

import { VIEW_TRACE_CALLOUT_DISMISSED_KEY } from '@/components/viewTraceCallout';
import { ViewTraceCalloutButton } from '@/components/ViewTraceCalloutButton';

// A provider that is reapplied on rerender, so prop transitions (row
// navigation) can be exercised across rerenders.
function MantineWrapper({ children }: { children: ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

const noop = () => undefined;

// Mirrors the real owner (DBRowSidePanelInner): it holds the auto-open latch and
// gates the button behind a "Loading..." state while a row resolves, unmounting
// the button exactly as the side panel does. The latch outlives that gate.
function PanelHarness({
  disabled = false,
  loading = false,
  onView = noop,
}: {
  disabled?: boolean;
  loading?: boolean;
  onView?: () => void;
}) {
  const [autoOpened, setAutoOpened] = useState(false);

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <ViewTraceCalloutButton
      disabled={disabled}
      onView={onView}
      autoOpened={autoOpened}
      onAutoOpen={() => setAutoOpened(true)}
    />
  );
}

describe('ViewTraceCalloutButton', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('auto-opens the one-time callout when enabled and not yet dismissed', async () => {
    render(<PanelHarness />, { wrapper: MantineWrapper });

    expect(screen.getByTestId('side-panel-view-trace')).toBeEnabled();
    // Auto-open is raised via an effect, so the dropdown mounts asynchronously.
    expect(await screen.findByTestId('view-trace-callout')).toBeInTheDocument();
    expect(screen.getByText('Got it')).toBeInTheDocument();
  });

  it('does not open the callout while the trace is unresolved (disabled)', () => {
    render(<PanelHarness disabled />, { wrapper: MantineWrapper });

    expect(screen.getByTestId('side-panel-view-trace')).toBeDisabled();
    expect(screen.queryByTestId('view-trace-callout')).not.toBeInTheDocument();
  });

  it('does not show the callout once it has been dismissed previously', () => {
    window.localStorage.setItem(
      VIEW_TRACE_CALLOUT_DISMISSED_KEY,
      JSON.stringify(true),
    );

    render(<PanelHarness />, { wrapper: MantineWrapper });

    // Button still available, but the nudge no longer appears.
    expect(screen.getByTestId('side-panel-view-trace')).toBeInTheDocument();
    expect(screen.queryByTestId('view-trace-callout')).not.toBeInTheDocument();
  });

  it('persists dismissal and navigates when the View Trace button is clicked', async () => {
    const onView = jest.fn();
    render(<PanelHarness onView={onView} />, { wrapper: MantineWrapper });

    fireEvent.click(await screen.findByTestId('side-panel-view-trace'));

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
    render(<PanelHarness onView={onView} />, { wrapper: MantineWrapper });

    fireEvent.click(await screen.findByText('Got it'));

    expect(onView).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(VIEW_TRACE_CALLOUT_DISMISSED_KEY)).toBe(
      JSON.stringify(true),
    );
    await waitForElementToBeRemoved(() =>
      screen.queryByTestId('view-trace-callout'),
    );
  });

  it('opens the callout once the trace resolves (disabled → enabled)', async () => {
    const { rerender } = render(<PanelHarness disabled />, {
      wrapper: MantineWrapper,
    });

    expect(screen.queryByTestId('view-trace-callout')).not.toBeInTheDocument();

    rerender(<PanelHarness disabled={false} />);

    expect(await screen.findByTestId('view-trace-callout')).toBeInTheDocument();
  });

  it('stays latched across the per-row loading gate that unmounts the button', async () => {
    // Paging to another row drops the panel into a "Loading..." state that
    // unmounts the button. Because the latch is owned by the parent, the nudge
    // must come back already open (synchronously, no re-run of the auto-open
    // effect) rather than reappearing from scratch on every row.
    const { rerender } = render(<PanelHarness />, { wrapper: MantineWrapper });

    expect(await screen.findByTestId('view-trace-callout')).toBeInTheDocument();

    // Next row starts loading: the button (and its popover) unmount.
    rerender(<PanelHarness loading />);
    expect(screen.queryByTestId('view-trace-callout')).not.toBeInTheDocument();

    // Row settles: the button remounts and the callout is open immediately.
    rerender(<PanelHarness />);
    expect(screen.getByTestId('view-trace-callout')).toBeInTheDocument();
  });
});
