import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  TimelineChartRowEvents,
  type TTimelineEvent,
} from '@/components/TimelineChart/TimelineChartRowEvents';

const makeEvent = (overrides: Partial<TTimelineEvent>): TTimelineEvent => ({
  id: 'e',
  start: 0,
  end: 0,
  tooltip: '',
  color: '#fff',
  backgroundColor: '#000',
  minWidthPx: 2,
  body: null,
  ...overrides,
});

const renderRow = (events: TTimelineEvent[], maxVal: number) =>
  renderWithMantine(
    <TimelineChartRowEvents events={events} maxVal={maxVal} height={20} />,
  );

const bars = (container: HTMLElement) =>
  Array.from(
    container.querySelectorAll<HTMLElement>('[style*="position: absolute"]'),
  );

describe('TimelineChartRowEvents width', () => {
  it('keeps a short span proportionally narrow instead of flooring its width percentage', () => {
    // 14ms span in an 8000ms timeline => 0.175%, not floored up.
    const { container } = renderRow(
      [makeEvent({ id: 'short', start: 0, end: 14, minWidthPx: 2 })],
      8000,
    );
    expect(parseFloat(bars(container)[0].style.width)).toBeCloseTo(0.175, 5);
  });

  it('applies the min-width floor in pixels so it does not scale with zoom', () => {
    const { container } = renderRow(
      [makeEvent({ id: 'short', start: 0, end: 14, minWidthPx: 2 })],
      8000,
    );
    expect(bars(container)[0].style.minWidth).toBe('2px');
  });

  it('renders a long span wider than a short one at the same zoom', () => {
    const { container } = renderRow(
      [
        makeEvent({ id: 'short', start: 0, end: 14, minWidthPx: 2 }),
        makeEvent({ id: 'long', start: 0, end: 2400, minWidthPx: 2 }),
      ],
      8000,
    );
    const [shortBar, longBar] = bars(container);
    expect(parseFloat(longBar.style.width)).toBeGreaterThan(
      parseFloat(shortBar.style.width),
    );
  });
});

describe('TimelineChartRowEvents span event markers', () => {
  it('colors exception events red and other events green', () => {
    const { container } = renderRow(
      [
        makeEvent({
          end: 10,
          markers: [
            { timestamp: 2, epochMs: 2, name: 'exception', attributes: {} },
            { timestamp: 6, epochMs: 6, name: 'cache.miss', attributes: {} },
          ],
        }),
      ],
      10,
    );

    const diamonds = Array.from(
      container.querySelectorAll<HTMLElement>('[style*="rotate(45deg)"]'),
    );
    expect(diamonds.map(d => d.style.backgroundColor)).toEqual([
      'var(--color-bg-danger)',
      'var(--color-bg-success)',
    ]);
  });

  it('shows the event time and red attribute keys in an exception tooltip', async () => {
    const { container } = renderRow(
      [
        makeEvent({
          end: 10,
          markers: [
            {
              timestamp: 2,
              epochMs: Date.UTC(2024, 5, 15, 12, 0, 0, 345),
              name: 'exception',
              attributes: { 'exception.type': 'TypeError' },
            },
          ],
        }),
      ],
      10,
    );

    await userEvent.hover(
      container.querySelector<HTMLElement>('[style*="rotate(45deg)"]')!
        .parentElement!,
    );

    expect((await screen.findByText('exception.type:')).style.color).toBe(
      'var(--color-text-danger)',
    );
    // The absolute event time, not its offset from the trace start.
    expect(screen.getByText(/^Jun 1[56] .*\.345/)).toBeInTheDocument();
  });
});
