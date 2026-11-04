import { screen } from '@testing-library/react';

import { TimelineChart } from '@/components/TimelineChart/TimelineChart';
import type { TTimelineEvent } from '@/components/TimelineChart/TimelineChartRowEvents';

function makeRow(id: string, start: number, end: number) {
  const event: TTimelineEvent = {
    id,
    start,
    end,
    tooltip: id,
    color: 'white',
    backgroundColor: 'gray',
    body: <span>{id}</span>,
    minWidthPx: 1,
  };
  return { id, label: <span>{id}</span>, events: [event] };
}

describe('TimelineChart', () => {
  it('shows the zoom hint in the corner above the labels, inside the chart', () => {
    renderWithMantine(
      <TimelineChart
        initialScrollRowIndex={-1}
        labelWidth={300}
        maxHeight={400}
        rowHeight={22}
        rows={[makeRow('root', 0, 100), makeRow('child', 10, 40)]}
        onEventClick={jest.fn()}
      />,
    );

    const hint = screen.getByTestId('timeline-zoom-hint');
    expect(hint).toHaveTextContent('⌘/Ctrl + scroll to zoom');
    // Lives in the corner cell above the span labels rather than in a row of
    // its own above the chart.
    expect(hint.closest('[data-testid="timeline-corner"]')).toBeInTheDocument();
  });
});
