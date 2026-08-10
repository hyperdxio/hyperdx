import { screen } from '@testing-library/react';

import ResultOverflowBanner from '@/components/charts/ResultOverflowBanner';

describe('ResultOverflowBanner', () => {
  it('renders nothing when didOverflow is false', () => {
    renderWithMantine(<ResultOverflowBanner didOverflow={false} cap={5000} />);
    expect(screen.queryByText(/row cap/)).not.toBeInTheDocument();
  });

  it('renders nothing when didOverflow is undefined', () => {
    renderWithMantine(
      <ResultOverflowBanner didOverflow={undefined} cap={5000} />,
    );
    expect(screen.queryByText(/row cap/)).not.toBeInTheDocument();
  });

  it('renders the cap warning with the returned row count when overflowed', () => {
    renderWithMantine(
      <ResultOverflowBanner didOverflow cap={5000} rows={6250} />,
    );
    // Prefers the concrete returned-row count over the cap.
    expect(screen.getByText(/6,250-row cap/)).toBeInTheDocument();
    expect(screen.getByText(/may be missing data/)).toBeInTheDocument();
  });

  it('falls back to the cap when rows is omitted', () => {
    renderWithMantine(<ResultOverflowBanner didOverflow cap={5000} />);
    expect(screen.getByText(/5,000-row cap/)).toBeInTheDocument();
  });

  it('includes the series count when provided', () => {
    renderWithMantine(
      <ResultOverflowBanner didOverflow cap={5000} rows={6250} series={1250} />,
    );
    expect(screen.getByText(/~1,250 series/)).toBeInTheDocument();
  });

  it('omits the series suffix when series is not provided', () => {
    renderWithMantine(
      <ResultOverflowBanner didOverflow cap={5000} rows={6250} />,
    );
    expect(screen.queryByText(/series/)).not.toBeInTheDocument();
  });
});
