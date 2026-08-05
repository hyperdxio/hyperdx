import { fireEvent, screen } from '@testing-library/react';

import { VIEW_TRACE_CALLOUT_DISMISSED_KEY } from '@/components/viewTraceCallout';
import { ViewTraceCalloutButton } from '@/components/ViewTraceCalloutButton';

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

  it('persists dismissal and navigates when the View Trace button is clicked', () => {
    const onView = jest.fn();
    renderWithMantine(
      <ViewTraceCalloutButton disabled={false} onView={onView} />,
    );

    fireEvent.click(screen.getByTestId('side-panel-view-trace'));

    expect(onView).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(VIEW_TRACE_CALLOUT_DISMISSED_KEY)).toBe(
      JSON.stringify(true),
    );
  });

  it('persists dismissal without navigating when "Got it" is clicked', () => {
    const onView = jest.fn();
    renderWithMantine(
      <ViewTraceCalloutButton disabled={false} onView={onView} />,
    );

    fireEvent.click(screen.getByText('Got it'));

    expect(onView).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(VIEW_TRACE_CALLOUT_DISMISSED_KEY)).toBe(
      JSON.stringify(true),
    );
  });
});
