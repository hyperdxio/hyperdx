import React from 'react';
import {
  AlertErrorType,
  AlertEvaluation,
  AlertState,
} from '@hyperdx/common-utils/dist/types';
import { fireEvent, screen, within } from '@testing-library/react';

import { AlertEvaluationsTable } from '@/components/alerts/AlertEvaluationsTable';

// Controls whether the infinite-scroll sentinel reports itself as visible.
let mockInViewport = false;
jest.mock('@mantine/hooks', () => ({
  ...jest.requireActual('@mantine/hooks'),
  useInViewport: () => ({ ref: jest.fn(), inViewport: mockInViewport }),
}));

// Render raw ISO timestamps so time assertions don't depend on the test
// runner's timezone or the user's clock-format preference.
jest.mock('@/useFormatTime', () => ({
  FormatTime: ({ value }: { value?: number | string | Date }) =>
    value ? new Date(value).toISOString() : null,
}));

const okWindow: AlertEvaluation = {
  counts: 0,
  createdAt: '2026-04-17T12:05:00.000Z',
  lastValues: [{ startTime: '2026-04-17T12:00:00.000Z', count: 3 }],
  state: AlertState.OK,
};

const errorWindow: AlertEvaluation = {
  counts: 0,
  createdAt: '2026-04-17T12:10:00.000Z',
  lastValues: [],
  state: AlertState.ERROR,
  errors: [
    {
      timestamp: '2026-04-17T12:11:00.000Z',
      type: AlertErrorType.QUERY_TIMEOUT,
      message:
        'Alert query did not complete within the 300s evaluation timeout.',
    },
  ],
};

const groupedFiringWindow: AlertEvaluation = {
  counts: 2,
  createdAt: '2026-04-17T12:15:00.000Z',
  lastValues: [
    { startTime: '2026-04-17T12:10:00.000Z', count: 1 },
    { startTime: '2026-04-17T12:10:00.000Z', count: 14 },
  ],
  state: AlertState.ALERT,
  groups: [
    {
      group: 'ServiceName:api',
      state: AlertState.ALERT,
      counts: 2,
      lastValue: { startTime: '2026-04-17T12:10:00.000Z', count: 14 },
      fired: true,
    },
    {
      group: 'ServiceName:web',
      state: AlertState.OK,
      counts: 0,
      lastValue: { startTime: '2026-04-17T12:10:00.000Z', count: 1 },
    },
  ],
  groupsTotal: 2,
  analytics: {
    queryDurationMs: 1200,
    webhookDurationMs: 340,
    backfilledBuckets: 0,
  },
};

const backfilledWindow: AlertEvaluation = {
  counts: 0,
  createdAt: '2026-04-17T12:20:00.000Z',
  lastValues: [
    { startTime: '2026-04-17T12:05:00.000Z', count: 0 },
    { startTime: '2026-04-17T12:10:00.000Z', count: 0 },
    { startTime: '2026-04-17T12:15:00.000Z', count: 0 },
  ],
  state: AlertState.OK,
  analytics: { queryDurationMs: 800, backfilledBuckets: 2 },
};

const renderTable = (
  props: Partial<React.ComponentProps<typeof AlertEvaluationsTable>> = {},
) =>
  renderWithMantine(
    <AlertEvaluationsTable
      evaluations={[errorWindow, okWindow]}
      interval="5m"
      isLoading={false}
      isError={false}
      hasNextPage={false}
      isFetchingNextPage={false}
      onLoadMore={jest.fn()}
      {...props}
    />,
  );

describe('AlertEvaluationsTable', () => {
  beforeEach(() => {
    mockInViewport = false;
  });

  it('renders one row per evaluation window with state badges', () => {
    renderTable();

    const rows = screen.getAllByTestId('alert-evaluation-row');
    expect(rows).toHaveLength(2);
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('Ok')).toBeInTheDocument();
    // OK row shows the latest value
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('labels each row with the evaluated bucket start, matching the chart', () => {
    renderTable({
      evaluations: [backfilledWindow, errorWindow, okWindow],
    });

    const rows = screen.getAllByTestId('alert-evaluation-row');
    // Backfilled window (createdAt 12:20, buckets 12:05/12:10/12:15) is
    // labeled with the newest evaluated bucket, not the evaluation time
    expect(rows[0]).toHaveTextContent('2026-04-17T12:15:00.000Z');
    expect(rows[0]).not.toHaveTextContent('2026-04-17T12:20:00.000Z');
    // Failed evaluation has no lastValues: falls back to createdAt − interval
    expect(rows[1]).toHaveTextContent('2026-04-17T12:05:00.000Z');
    expect(rows[1]).not.toHaveTextContent('2026-04-17T12:10:00.000Z');
    // OK window (createdAt 12:05) shows its bucket start 12:00
    expect(rows[2]).toHaveTextContent('2026-04-17T12:00:00.000Z');
    expect(rows[2]).not.toHaveTextContent('2026-04-17T12:05:00.000Z');
  });

  it('shows the error type label and expands to the full message', () => {
    renderTable();

    expect(screen.getByText('Query Timeout')).toBeInTheDocument();
    expect(
      screen.queryByText(/did not complete within the 300s/),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Query Timeout'));

    expect(
      screen.getByText(/did not complete within the 300s/),
    ).toBeInTheDocument();
  });

  it('fetches the next page when the scroll sentinel enters the viewport', () => {
    mockInViewport = true;
    const onLoadMore = jest.fn();
    renderTable({ hasNextPage: true, onLoadMore });

    expect(
      screen.getByTestId('alert-evaluations-load-more'),
    ).toBeInTheDocument();
    expect(onLoadMore).toHaveBeenCalled();
  });

  it('does not fetch while a page is already being fetched', () => {
    mockInViewport = true;
    const onLoadMore = jest.fn();
    renderTable({ hasNextPage: true, isFetchingNextPage: true, onLoadMore });

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('does not render the sentinel when there are no older pages', () => {
    renderTable({ hasNextPage: false });
    expect(
      screen.queryByTestId('alert-evaluations-load-more'),
    ).not.toBeInTheDocument();
  });

  it('stops auto-fetching and offers a retry once a page fetch fails', () => {
    // Without this, the sentinel effect refires each time the failed fetch
    // settles (isFetchingNextPage true -> false), refetching forever.
    mockInViewport = true;
    const onLoadMore = jest.fn();
    renderTable({ hasNextPage: true, isError: true, onLoadMore });

    // The sentinel is unmounted, so nothing auto-fetches
    expect(
      screen.queryByTestId('alert-evaluations-load-more'),
    ).not.toBeInTheDocument();
    expect(onLoadMore).not.toHaveBeenCalled();

    // An explicit retry affordance replaces it
    expect(
      screen.getByTestId('alert-evaluations-load-error'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('shows a failure message when the first page fails to load', () => {
    renderTable({ evaluations: [], isError: true });
    expect(screen.getByTestId('alert-evaluations-error')).toBeInTheDocument();
    expect(
      screen.queryByText(/No evaluations in the selected time range/),
    ).not.toBeInTheDocument();
  });

  it('renders an empty state when the range has no evaluations', () => {
    renderTable({ evaluations: [] });
    expect(
      screen.getByText(/No evaluations in the selected time range/),
    ).toBeInTheDocument();
  });

  it('renders grouped windows collapsed, expanding into per-group child rows on click', () => {
    renderTable({
      evaluations: [groupedFiringWindow, errorWindow, okWindow],
    });

    // Group summary on the parent row, but children stay collapsed —
    // no rows auto-expand
    expect(screen.getByText('1/2 groups firing')).toBeInTheDocument();
    expect(screen.queryAllByTestId('alert-evaluation-group-row')).toHaveLength(
      0,
    );

    fireEvent.click(screen.getByText('1/2 groups firing'));

    // Expanded: per-group child rows, firing first
    const groupRows = screen.getAllByTestId('alert-evaluation-group-row');
    expect(groupRows).toHaveLength(2);
    expect(groupRows[0]).toHaveTextContent('ServiceName:api');
    expect(groupRows[0]).toHaveTextContent('Alert');
    expect(groupRows[0]).toHaveTextContent('14');
    expect(groupRows[1]).toHaveTextContent('ServiceName:web');
    expect(groupRows[1]).toHaveTextContent('Ok');

    // Clicking again collapses
    fireEvent.click(screen.getByText('1/2 groups firing'));
    expect(screen.queryAllByTestId('alert-evaluation-group-row')).toHaveLength(
      0,
    );
  });

  it('explains the server-side group cap when groups were omitted', () => {
    renderTable({
      evaluations: [{ ...groupedFiringWindow, groupsTotal: 60 }],
    });

    expect(screen.getByText('1/60 groups firing')).toBeInTheDocument();

    fireEvent.click(screen.getByText('1/60 groups firing'));

    expect(
      screen.getByText(
        /Showing the top 50 of 60 groups \(firing first\) — additional groups aren't fetched\./,
      ),
    ).toBeInTheDocument();
  });

  it('hides the window-level value for grouped windows', () => {
    renderTable({ evaluations: [groupedFiringWindow] });

    const parentRow = screen.getByTestId('alert-evaluation-row');
    // Latest Value cell shows a dash; per-group values live in child rows
    expect(parentRow).not.toHaveTextContent('14');
  });

  it('shows backfilled buckets on the parent row when ticks were missed', () => {
    renderTable({ evaluations: [backfilledWindow, okWindow] });

    const rows = screen.getAllByTestId('alert-evaluation-row');
    // Backfilled Buckets is the 5th column
    expect(within(rows[0]).getAllByRole('cell')[4]).toHaveTextContent('2');
    // Steady-state window shows a dash in the Backfilled Buckets column
    expect(within(rows[1]).getAllByRole('cell')[4]).toHaveTextContent('–');
  });

  it('shows query and webhook durations as columns on the parent row', () => {
    renderTable({ evaluations: [groupedFiringWindow, errorWindow] });

    const rows = screen.getAllByTestId('alert-evaluation-row');
    // Visible without expanding anything
    expect(rows[0]).toHaveTextContent('1.2s');
    expect(rows[0]).toHaveTextContent('340ms');
    // Window without analytics shows dashes in the duration columns
    expect(rows[1]).not.toHaveTextContent('1.2s');
    expect(rows[1]).not.toHaveTextContent('340ms');
  });
});
