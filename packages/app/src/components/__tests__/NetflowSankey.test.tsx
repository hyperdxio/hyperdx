import { ReactNode } from 'react';
import { SourceKind, TNetflowSource } from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { screen } from '@testing-library/react';

import NetflowSankey from '@/components/NetflowSankey';
import NetflowSankeyChart from '@/components/NetflowSankeyChart';
import { buildNetflowQueryConfigs } from '@/netflow';
import { buildNetflowSankeyData } from '@/netflowSankey';

let mockRender: 'node' | 'link' = 'node';
let mockIndex = 99;
jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => children,
  Sankey: ({
    node,
    link,
  }: {
    node: (props: { index: number }) => ReactNode;
    link: (props: { index: number }) => ReactNode;
  }) => (
    <svg data-testid="mock-sankey">
      {(mockRender === 'node' ? node : link)({ index: mockIndex })}
    </svg>
  ),
}));

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

it.each(['node', 'link', 'source', 'target'] as const)(
  'ignores an out-of-bounds Sankey %s during a data transition',
  missing => {
    const dimensions = [
      { key: 'src', label: 'Source', expression: 'SrcAddr' },
      { key: 'dst', label: 'Destination', expression: 'DstAddr' },
    ];
    const data = buildNetflowSankeyData(
      [
        {
          __netflow_dimension_0: 'a',
          __netflow_dimension_1: 'b',
          __netflow_value: 100,
        },
      ],
      dimensions,
    );
    mockRender = missing === 'node' ? 'node' : 'link';
    mockIndex = missing === 'node' || missing === 'link' ? 99 : 0;
    if (missing === 'source' || missing === 'target')
      data.links[0][missing] = 99;
    renderWithMantine(
      <NetflowSankeyChart
        data={data}
        dimensions={dimensions}
        rangeSeconds={60}
      />,
    );
    expect(
      screen.getByTestId('mock-sankey').querySelector('rect, path'),
    ).toBeNull();
  },
);

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
