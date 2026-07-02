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
  body: null,
  ...overrides,
});

const renderRow = (events: TTimelineEvent[], maxVal: number) =>
  renderWithMantine(
    <TimelineChartRowEvents events={events} maxVal={maxVal} height={20} />,
  );

const bars = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>('[style*="width"]'));

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
