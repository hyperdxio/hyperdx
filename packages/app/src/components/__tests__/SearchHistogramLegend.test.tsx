import React from 'react';
import {
  BuilderChartConfigWithDateRange,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SearchHistogramLegend from '@/components/SearchHistogramLegend';
import { COLORS } from '@/utils';

const mockUseSearchHistogramQuery = jest.fn();
const mockUseSource = jest.fn();

jest.mock('@/hooks/useSearchHistogramQuery', () => ({
  ...jest.requireActual('@/hooks/useSearchHistogramQuery'),
  useSearchHistogramQuery: (...args: unknown[]) =>
    mockUseSearchHistogramQuery(...args),
}));

jest.mock('@/source', () => ({
  ...jest.requireActual('@/source'),
  useSource: (...args: unknown[]) => mockUseSource(...args),
}));

// Keep in sync with SEMANTIC_CHART_PALETTE in @/utils.
const SEMANTIC_INFO_HEX = '#437eef';
const SEMANTIC_WARNING_HEX = '#efb118';
const SEMANTIC_ERROR_HEX = '#ff725c';

const CONFIG: BuilderChartConfigWithDateRange = {
  select: 'count()',
  from: { databaseName: 'test', tableName: 'logs' },
  where: '',
  timestampValueExpression: 'Timestamp',
  connection: 'test-connection',
  dateRange: [new Date('2024-01-01'), new Date('2024-01-02')],
};

const LOG_SOURCE = {
  kind: SourceKind.Log,
  severityTextExpression: 'SeverityText',
} as TSource;

type Row = { bucket: string; count: string | number; group: string };

function mockResponse(
  rows: Row[],
  { groupColumn = 'SeverityText' }: { groupColumn?: string } = {},
) {
  mockUseSearchHistogramQuery.mockReturnValue({
    data: {
      meta: [
        { name: 'count()', type: 'UInt64' },
        { name: groupColumn, type: 'LowCardinality(String)' },
        { name: '__hdx_time_bucket', type: 'DateTime' },
      ],
      data: rows.map(r => ({
        __hdx_time_bucket: r.bucket,
        'count()': r.count,
        [groupColumn]: r.group,
      })),
      isComplete: true,
    },
    isLoading: false,
  });
}

function renderLegend(
  onFocusSeries?: (filters: { column: string; value: string }[]) => void,
) {
  return renderWithMantine(
    <SearchHistogramLegend
      config={CONFIG}
      queryKeyPrefix="search"
      onFocusSeries={onFocusSeries}
    />,
  );
}

/** The rendered item labels, in display order. */
function legendLabels() {
  return screen
    .getAllByLabelText(/^Filter by /)
    .map(el => el.getAttribute('aria-label')!.replace('Filter by ', ''));
}

const BUCKET_A = '2024-01-01T00:00:00Z';
const BUCKET_B = '2024-01-01T00:01:00Z';

describe('SearchHistogramLegend', () => {
  beforeEach(() => {
    mockUseSearchHistogramQuery.mockReset();
    mockUseSource.mockReset();
    mockUseSource.mockReturnValue({ data: LOG_SOURCE });
  });

  it('sums each series across every bucket in the selected range', () => {
    // The point of the legend: whole-range totals, not one bucket's values.
    mockResponse([
      { bucket: BUCKET_A, count: '30', group: 'info' },
      { bucket: BUCKET_B, count: '20', group: 'info' },
      { bucket: BUCKET_A, count: '10', group: 'warn' },
      { bucket: BUCKET_B, count: '5', group: 'warn' },
      { bucket: BUCKET_B, count: '3', group: 'error' },
    ]);

    renderLegend();

    expect(screen.getByLabelText('Filter by info')).toHaveTextContent('info50');
    expect(screen.getByLabelText('Filter by warn')).toHaveTextContent('warn15');
    expect(screen.getByLabelText('Filter by error')).toHaveTextContent(
      'error3',
    );
  });

  it('lists the most severe series first so error counts lead', () => {
    mockResponse([
      { bucket: BUCKET_A, count: 50, group: 'info' },
      { bucket: BUCKET_A, count: 15, group: 'warn' },
      { bucket: BUCKET_A, count: 5, group: 'error' },
    ]);

    renderLegend();

    expect(legendLabels()).toEqual(['error', 'warn', 'info']);
  });

  it('shows whatever severity values the query returned, without rolling them up', () => {
    // 'debug' and 'info' are both info-colored but are distinct stacked series
    // in the chart, so the legend must not merge them into one "Info" row.
    mockResponse([
      { bucket: BUCKET_A, count: 30, group: 'info' },
      { bucket: BUCKET_A, count: 4, group: 'debug' },
      { bucket: BUCKET_A, count: 2, group: 'trace' },
      { bucket: BUCKET_A, count: 6, group: 'fatal' },
    ]);

    renderLegend();

    expect(legendLabels()).toEqual(['fatal', 'info', 'debug', 'trace']);
    expect(screen.getByLabelText('Filter by debug')).toHaveTextContent(
      'debug4',
    );
  });

  it('colors severity-like series semantically', () => {
    mockResponse([
      { bucket: BUCKET_A, count: 5, group: 'info' },
      { bucket: BUCKET_A, count: 5, group: 'warn' },
      { bucket: BUCKET_A, count: 5, group: 'error' },
    ]);

    renderLegend();

    const swatch = (label: string) =>
      screen.getByLabelText(`Filter by ${label}`).querySelector('div > div');
    expect(swatch('info')).toHaveStyle({ backgroundColor: SEMANTIC_INFO_HEX });
    expect(swatch('warn')).toHaveStyle({
      backgroundColor: SEMANTIC_WARNING_HEX,
    });
    expect(swatch('error')).toHaveStyle({
      backgroundColor: SEMANTIC_ERROR_HEX,
    });
  });

  it('falls back to palette colors and biggest-first order for non-severity groups', () => {
    mockUseSource.mockReturnValue({ data: undefined });
    mockResponse(
      [
        { bucket: BUCKET_A, count: 7, group: 'checkout' },
        { bucket: BUCKET_A, count: 9, group: 'shipping' },
      ],
      { groupColumn: 'ServiceName' },
    );

    renderLegend();

    expect(legendLabels()).toEqual(['shipping', 'checkout']);
    // Palette colors are assigned in chart series order, not display order.
    expect(
      screen.getByLabelText('Filter by checkout').querySelector('div > div'),
    ).toHaveStyle({ backgroundColor: COLORS[0] });
    expect(
      screen.getByLabelText('Filter by shipping').querySelector('div > div'),
    ).toHaveStyle({ backgroundColor: COLORS[1] });
  });

  it('reports the clicked series as a column/value filter', async () => {
    mockResponse([
      { bucket: BUCKET_A, count: 50, group: 'info' },
      { bucket: BUCKET_A, count: 5, group: 'error' },
    ]);

    const onFocusSeries = jest.fn();
    renderLegend(onFocusSeries);

    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Filter by error'));

    expect(onFocusSeries).toHaveBeenCalledTimes(1);
    expect(onFocusSeries).toHaveBeenCalledWith([
      { column: 'SeverityText', value: 'error' },
    ]);
  });

  it('moves series past the inline cap into a "+N more" popover', async () => {
    mockUseSource.mockReturnValue({ data: undefined });
    mockResponse(
      Array.from({ length: 9 }, (_, i) => ({
        bucket: BUCKET_A,
        count: 100 - i,
        group: `service-${i}`,
      })),
      { groupColumn: 'ServiceName' },
    );

    renderLegend();

    // Six inline, the rest behind the overflow toggle.
    expect(legendLabels()).toEqual([
      'service-0',
      'service-1',
      'service-2',
      'service-3',
      'service-4',
      'service-5',
    ]);
    expect(screen.getByText('+3 more')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Show remaining series'));

    expect(
      await screen.findByLabelText('Filter by service-8'),
    ).toHaveTextContent('service-892');
  });

  it('renders nothing for an ungrouped query, whose total is already shown above', () => {
    mockUseSearchHistogramQuery.mockReturnValue({
      data: {
        meta: [
          { name: 'count()', type: 'UInt64' },
          { name: '__hdx_time_bucket', type: 'DateTime' },
        ],
        data: [{ __hdx_time_bucket: BUCKET_A, 'count()': '70' }],
        isComplete: true,
      },
      isLoading: false,
    });

    renderLegend();

    expect(
      screen.queryByTestId('search-histogram-legend'),
    ).not.toBeInTheDocument();
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
    });

    renderLegend();

    expect(
      screen.queryByTestId('search-histogram-legend'),
    ).not.toBeInTheDocument();
  });

  it('renders nothing rather than throwing on an unusable response shape', () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    // No timestamp column: the chart formatter throws on this.
    mockUseSearchHistogramQuery.mockReturnValue({
      data: {
        meta: [{ name: 'count()', type: 'UInt64' }],
        data: [{ 'count()': '1' }],
        isComplete: true,
      },
      isLoading: false,
    });

    renderLegend();

    expect(
      screen.queryByTestId('search-histogram-legend'),
    ).not.toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
