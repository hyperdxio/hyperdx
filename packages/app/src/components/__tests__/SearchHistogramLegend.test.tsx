import React from 'react';
import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SearchHistogramLegend from '@/components/SearchHistogramLegend';

const mockUseSearchHistogramQuery = jest.fn();

jest.mock('@/hooks/useSearchHistogramQuery', () => ({
  ...jest.requireActual('@/hooks/useSearchHistogramQuery'),
  useSearchHistogramQuery: (...args: unknown[]) =>
    mockUseSearchHistogramQuery(...args),
}));

const CONFIG: BuilderChartConfigWithDateRange = {
  select: 'count()',
  from: { databaseName: 'test', tableName: 'logs' },
  where: '',
  timestampValueExpression: 'Timestamp',
  connection: 'test-connection',
  dateRange: [new Date('2024-01-01'), new Date('2024-01-02')],
};

const META = [
  { name: '__hdx_time_bucket', type: 'DateTime' },
  { name: 'count()', type: 'UInt64' },
  { name: 'SeverityText', type: 'String' },
];

function mockResponse(
  rows: { bucket: string; count: string | number; severity: string }[],
) {
  mockUseSearchHistogramQuery.mockReturnValue({
    data: {
      meta: META,
      data: rows.map(r => ({
        __hdx_time_bucket: r.bucket,
        'count()': r.count,
        SeverityText: r.severity,
      })),
      isComplete: true,
    },
    isLoading: false,
    isError: false,
    error: null,
  });
}

function renderLegend(onSeverityClick?: (rawValues: string[]) => void) {
  return renderWithMantine(
    <SearchHistogramLegend
      config={CONFIG}
      queryKeyPrefix="search"
      onSeverityClick={onSeverityClick}
    />,
  );
}

describe('SearchHistogramLegend', () => {
  beforeEach(() => {
    mockUseSearchHistogramQuery.mockReset();
  });

  it('sums counts for each severity across every time bucket in the range', () => {
    // The whole point of the legend: totals span the full window, not one bucket.
    mockResponse([
      { bucket: '2024-01-01 00:00:00', count: '30', severity: 'info' },
      { bucket: '2024-01-01 01:00:00', count: '20', severity: 'info' },
      { bucket: '2024-01-01 00:00:00', count: '10', severity: 'warn' },
      { bucket: '2024-01-01 01:00:00', count: '5', severity: 'warn' },
      { bucket: '2024-01-01 01:00:00', count: '3', severity: 'error' },
    ]);

    renderLegend();

    expect(screen.getByLabelText('Filter by Info')).toHaveTextContent('Info50');
    expect(screen.getByLabelText('Filter by Warn')).toHaveTextContent('Warn15');
    expect(screen.getByLabelText('Filter by Error')).toHaveTextContent(
      'Error3',
    );
  });

  it('rolls distinct raw severity values up into their log level class', () => {
    mockResponse([
      { bucket: '2024-01-01 00:00:00', count: 4, severity: 'ERROR' },
      { bucket: '2024-01-01 00:00:00', count: 3, severity: 'fatal' },
      { bucket: '2024-01-01 00:00:00', count: 2, severity: 'critical' },
      { bucket: '2024-01-01 00:00:00', count: 1, severity: 'Err' },
    ]);

    renderLegend();

    expect(screen.getByLabelText('Filter by Error')).toHaveTextContent(
      'Error10',
    );
    expect(screen.queryByLabelText('Filter by Info')).not.toBeInTheDocument();
  });

  it('counts unrecognized severities as info so the legend totals match the result count', () => {
    mockResponse([
      { bucket: '2024-01-01 00:00:00', count: 7, severity: 'info' },
      { bucket: '2024-01-01 00:00:00', count: 2, severity: 'something-odd' },
      { bucket: '2024-01-01 00:00:00', count: 1, severity: '' },
    ]);

    renderLegend();

    expect(screen.getByLabelText('Filter by Info')).toHaveTextContent('Info10');
  });

  it('reports every raw value of the clicked class so filtering keeps them all', async () => {
    mockResponse([
      { bucket: '2024-01-01 00:00:00', count: 4, severity: 'ERROR' },
      { bucket: '2024-01-01 00:00:00', count: 3, severity: 'fatal' },
    ]);

    const onSeverityClick = jest.fn();
    renderLegend(onSeverityClick);

    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Filter by Error'));

    expect(onSeverityClick).toHaveBeenCalledTimes(1);
    expect(onSeverityClick.mock.calls[0][0].sort()).toEqual(
      ['ERROR', 'fatal'].sort(),
    );
  });

  it('orders items info, warn, error to match the histogram stacking order', () => {
    mockResponse([
      { bucket: '2024-01-01 00:00:00', count: 1, severity: 'error' },
      { bucket: '2024-01-01 00:00:00', count: 2, severity: 'info' },
      { bucket: '2024-01-01 00:00:00', count: 3, severity: 'warn' },
    ]);

    renderLegend();

    const labels = screen
      .getByTestId('search-histogram-legend')
      .querySelectorAll('[aria-label^="Filter by"]');
    expect(Array.from(labels).map(el => el.getAttribute('aria-label'))).toEqual(
      ['Filter by Info', 'Filter by Warn', 'Filter by Error'],
    );
  });

  it('renders nothing when the range has no rows', () => {
    mockResponse([]);

    renderLegend();

    expect(
      screen.queryByTestId('search-histogram-legend'),
    ).not.toBeInTheDocument();
  });

  it('renders nothing while the shared histogram query is still loading', () => {
    mockUseSearchHistogramQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    });

    renderLegend();

    expect(
      screen.queryByTestId('search-histogram-legend'),
    ).not.toBeInTheDocument();
  });
});
