import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { fireEvent, screen, within } from '@testing-library/react';

import NetflowRecords from '@/components/NetflowRecords';

const mockQuery = jest.fn();
jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: () => mockQuery(),
}));

const config: BuilderChartConfigWithDateRange = {
  connection: 'test',
  from: { databaseName: 'netflow', tableName: 'flows' },
  timestampValueExpression: 'TimeReceived',
  dateRange: [
    new Date('2026-10-09T12:00:00Z'),
    new Date('2026-10-09T13:00:00Z'),
  ],
  select: '*',
  where: '',
};

describe('NetFlow records', () => {
  it('shows sampled counters and exposes raw counters in flow details', async () => {
    mockQuery.mockReturnValue({
      isLoading: false,
      data: {
        data: [
          {
            __netflow_timestamp: '2026-10-09 12:30:00',
            __netflow_srcAddr: '10.0.0.1',
            __netflow_srcPort: 1234,
            __netflow_dstAddr: '2001:db8::1',
            __netflow_dstPort: 443,
            __netflow_protocol: 'TCP',
            __netflow_exporter: 'edge-1',
            __netflow_bytes: 100000,
            __netflow_packets: 2000,
            __netflow_rawBytes: 1000,
            __netflow_rawPackets: 20,
            __netflow_samplingRate: 100,
            __netflow_inputInterface: 'uplink',
            __netflow_outputInterface: 'lan',
          },
        ],
      },
    });
    renderWithMantine(<NetflowRecords config={config} />);

    expect(screen.getByText('10.0.0.1 · 1234')).toBeInTheDocument();
    expect(screen.getByText('2001:db8::1 · 443')).toBeInTheDocument();
    expect(screen.getByText('2,000')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect flow 1' }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('100000')).toBeInTheDocument();
    expect(within(drawer).getByText('1000')).toBeInTheDocument();
    expect(within(drawer).getByText('Sampling rate')).toBeInTheDocument();
    expect(within(drawer).getByText('100')).toBeInTheDocument();
    expect(within(drawer).getByText('uplink')).toBeInTheDocument();
  });

  it('shows an actionable empty state for a filter with no matching records', () => {
    mockQuery.mockReturnValue({ isLoading: false, data: { data: [] } });
    renderWithMantine(<NetflowRecords config={config} />);
    expect(screen.getByText('No flow records found')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Inspect flow/ }),
    ).not.toBeInTheDocument();
  });

  it('shows query errors without rendering stale records', () => {
    mockQuery.mockReturnValue({
      isLoading: false,
      error: new Error('Missing flow column'),
    });
    renderWithMantine(<NetflowRecords config={config} />);
    expect(screen.getByTestId('chart-error-state')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Inspect flow/ }),
    ).not.toBeInTheDocument();
  });
});
