import { Exemplar } from '@hyperdx/common-utils/dist/types';

import { ExemplarHoverCard } from '@/components/Exemplars/ExemplarHoverCard';

const exemplar: Exemplar = {
  timestamp: 1704067200000, // 2024-01-01T00:00:00Z
  value: 1234.5,
  traceId: 'abc123def456789012345678',
};

const props = {
  hovered: { exemplar, x: 10, y: 20 },
  isLoading: false,
  traceSourceConfigured: false,
  onInspect: jest.fn(),
  onMouseEnter: jest.fn(),
  onMouseLeave: jest.fn(),
};

/**
 * The marker's drawn position is deliberately not the truth: clampExemplarY pins
 * it into the y-domain and clampExemplarX into the x-domain. Both clamps are
 * justified in code by the card reporting the real value and time, so these are
 * the assertions that keep that justification honest.
 */
describe('ExemplarHoverCard', () => {
  it('always shows the exemplar value and time', () => {
    const { getByText } = renderWithMantine(<ExemplarHoverCard {...props} />);
    expect(getByText(/Value:/).textContent).toContain('1234.5');
    // Rendered through the user's time preference (local vs UTC, 12h vs 24h), so
    // assert a clock is present rather than pinning a timezone-dependent string.
    expect(getByText(/Time:/).textContent).toMatch(/\d{1,2}:\d{2}/);
  });

  it('shows them even with no trace source configured', () => {
    // The value/time rows must not live inside the trace-source branch — a chart
    // with no exemplar trace source still needs to explain its markers.
    const { getByText } = renderWithMantine(
      <ExemplarHoverCard {...props} traceSourceConfigured={false} />,
    );
    expect(getByText(/Set an exemplar trace source/)).toBeInTheDocument();
    expect(getByText(/Value:/).textContent).toContain('1234.5');
  });

  it('shows them while trace metadata is still loading', () => {
    const { getByText } = renderWithMantine(
      <ExemplarHoverCard {...props} traceSourceConfigured isLoading />,
    );
    expect(getByText(/Loading trace/)).toBeInTheDocument();
    expect(getByText(/Value:/).textContent).toContain('1234.5');
  });

  it('shows them when the trace is not found in the source', () => {
    const { getByText } = renderWithMantine(
      <ExemplarHoverCard {...props} traceSourceConfigured meta={undefined} />,
    );
    expect(getByText(/Trace not found/)).toBeInTheDocument();
    expect(getByText(/Value:/).textContent).toContain('1234.5');
  });

  it('formats the value with the chart number format', () => {
    // Otherwise a milliseconds axis and a "1234.5" card disagree about units.
    const { getByText } = renderWithMantine(
      <ExemplarHoverCard
        {...props}
        numberFormat={{ output: 'number', mantissa: 0, unit: 'ms' }}
      />,
    );
    expect(getByText(/Value:/).textContent).toContain('ms');
  });

  it('renders nothing when no marker is hovered', () => {
    const { queryByText } = renderWithMantine(
      <ExemplarHoverCard {...props} hovered={null} />,
    );
    expect(queryByText(/Value:/)).toBeNull();
  });
});
