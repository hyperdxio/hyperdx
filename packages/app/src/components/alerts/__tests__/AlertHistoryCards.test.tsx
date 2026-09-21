import React from 'react';
import {
  AlertErrorType,
  AlertHistory,
  AlertState,
  AlertThresholdType,
} from '@hyperdx/common-utils/dist/types';
import { fireEvent, screen } from '@testing-library/react';

import { AlertHistoryCardList } from '@/components/alerts/AlertHistoryCards';
import type { AlertsPageItem } from '@/types';

const makeAlert = (history: AlertHistory[]): AlertsPageItem => ({
  _id: 'alert-1',
  displayName: 'Alert 1',
  tags: [],
  interval: '5m',
  threshold: 1,
  thresholdType: AlertThresholdType.ABOVE,
  channel: { type: 'webhook' },
  createdAt: '2026-04-17T00:00:00.000Z',
  updatedAt: '2026-04-17T00:00:00.000Z',
  history,
});

const okWindow: AlertHistory = {
  counts: 0,
  createdAt: '2026-04-17T12:05:00.000Z',
  lastValues: [{ startTime: '2026-04-17T12:00:00.000Z', count: 0 }],
  state: AlertState.OK,
};

const errorWindow: AlertHistory = {
  counts: 0,
  createdAt: '2026-04-17T12:10:00.000Z',
  lastValues: [],
  state: AlertState.ERROR,
  errors: [
    {
      timestamp: '2026-04-17T12:11:00.000Z',
      type: AlertErrorType.QUERY_ERROR,
      message: 'clickhouse kaput',
    },
  ],
};

describe('AlertHistoryCardList', () => {
  it('renders errored evaluations as buttons that open the error details modal', async () => {
    renderWithMantine(
      <AlertHistoryCardList alert={makeAlert([errorWindow, okWindow])} />,
    );

    const errorSegment = screen.getByRole('button', {
      name: 'View evaluation errors',
    });
    expect(errorSegment).toBeInTheDocument();
    expect(screen.queryByText('clickhouse kaput')).not.toBeInTheDocument();

    fireEvent.click(errorSegment);

    // The modal content mounts asynchronously (Mantine portal + transition)
    expect(await screen.findByText(/Query Error/)).toBeInTheDocument();
    expect(await screen.findByText('clickhouse kaput')).toBeInTheDocument();
  });

  it('does not render error buttons for normal windows', () => {
    renderWithMantine(<AlertHistoryCardList alert={makeAlert([okWindow])} />);
    expect(
      screen.queryByRole('button', { name: 'View evaluation errors' }),
    ).not.toBeInTheDocument();
  });
});
