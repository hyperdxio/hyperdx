import { SourceKind, TNetflowSource } from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { screen } from '@testing-library/react';

import NetflowSankey from '@/components/NetflowSankey';
import { buildNetflowQueryConfigs } from '@/netflow';

let mockColumns = [{ name: 'SrcAS', type: 'UInt32' }];
jest.mock('@/hooks/useMetadata', () => ({
  useColumns: () => ({ data: mockColumns }),
}));
jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: () => ({ data: { data: [] } }),
}));
jest.mock('@/source', () => ({ useSource: () => ({ data: source }) }));
jest.mock('nuqs', () => ({
  ...jest.requireActual('nuqs'),
  useQueryStates: () => [
    { sankeyDimensions: ['column:SrcAS', 'exporter'], sankeyLimit: 20 },
    jest.fn(),
  ],
}));

const source: TNetflowSource = {
  id: 'flows',
  name: 'Flows',
  kind: SourceKind.Netflow,
  connection: 'local',
  from: { databaseName: 'default', tableName: 'flows' },
  timestampValueExpression: 'TimeReceived',
  defaultTableSelectExpression: '*',
  bytesExpression: 'Bytes',
  packetsExpression: 'Packets',
  srcAddrExpression: 'SrcAddr',
  dstAddrExpression: 'DstAddr',
  srcPortExpression: 'SrcPort',
  dstPortExpression: 'DstPort',
  protocolExpression: 'Proto',
  exporterExpression: 'Exporter',
};

it('falls back to available dimensions when the selected column disappears on a source switch', () => {
  const baseConfig = buildNetflowQueryConfigs({
    source,
    dateRange: [new Date(0), new Date(60000)],
    filters: {},
  }).totalBytes;
  const view = renderWithMantine(<NetflowSankey baseConfig={baseConfig} />);
  expect(screen.getByText('No traffic paths found')).toBeInTheDocument();
  mockColumns = [];
  view.rerender(
    <MantineProvider>
      <NetflowSankey baseConfig={{ ...baseConfig, source: 'other' }} />
    </MantineProvider>,
  );
  expect(screen.getByText('No traffic paths found')).toBeInTheDocument();
  expect(
    screen.queryByText('Choose two to five dimensions'),
  ).not.toBeInTheDocument();
  expect(screen.getAllByText('Source IP').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Destination IP').length).toBeGreaterThan(0);
});
