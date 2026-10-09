import { ComponentType, useEffect, useState } from 'react';
import {
  Filter,
  SourceKind,
  TNetflowSource,
} from '@hyperdx/common-utils/dist/types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import { buildNetflowQueryConfigs } from '@/netflow';
import NetflowPage from '@/NetflowPage';

const mockSource: TNetflowSource = {
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
  exporterExpression: 'ExporterName',
};
const mockRange = [
  new Date('2026-10-09T12:00:00Z'),
  new Date('2026-10-09T13:00:00Z'),
];
const mockInitialParams = {
  source: 'flows',
  where: 'Proto:6',
  whereLanguage: 'lucene',
  filters: [],
  exporter: '',
  protocol: '',
  srcAddr: '',
  dstAddr: '',
};
let mockFilterChange: (filters: Filter[]) => void;

jest.mock(
  'next/dynamic',
  () => (loader: () => Promise<ComponentType>) => () => {
    const [Component, setComponent] = useState<ComponentType | null>(null);
    useEffect(() => {
      void loader().then(component => setComponent(() => component));
    }, []);
    return Component ? <Component /> : null;
  },
);
jest.mock('nuqs', () => ({
  ...jest.requireActual('nuqs'),
  useQueryStates: () => {
    const [params, setParams] = useState(mockInitialParams);
    return [
      params,
      (next: Partial<typeof mockInitialParams>) =>
        setParams(previous => ({ ...previous, ...next })),
    ];
  },
}));
jest.mock('@/source', () => ({ useSources: () => ({ data: [mockSource] }) }));
jest.mock('@/layout', () => ({
  withAppNavForSurface: () => (page: unknown) => page,
}));
jest.mock('@/theme/ThemeProvider', () => ({
  ...jest.requireActual('@/theme/ThemeProvider'),
  usePageTitle: () => 'NetFlow',
}));
jest.mock('@/netflow', () => ({
  buildNetflowQueryConfigs: jest.fn(() => ({})),
}));
jest.mock('@/components/NetflowCharts', () => () => null);
jest.mock('@/components/NetflowSourceModal', () => () => null);
jest.mock('@/components/SourceSelect', () => ({
  SourceSelectControlled: () => null,
}));
jest.mock('@/components/TimePicker', () => ({ TimePicker: () => null }));
jest.mock('@/hooks/useDashboardRefresh', () => ({
  useDashboardRefresh: () => ({ refresh: jest.fn() }),
}));
jest.mock('@/timeQuery', () => ({
  useDefaultTimeRange: () => mockRange,
  useNewTimeQuery: () => ({
    searchedTimeRange: mockRange,
    onSearch: jest.fn(),
  }),
}));
jest.mock('@/components/NetflowFilterPills', () => ({
  __esModule: true,
  default: () => null,
  useNetflowFilterState: ({
    onChange,
  }: {
    onChange: typeof mockFilterChange;
  }) => {
    mockFilterChange = onChange;
    return {};
  },
}));
jest.mock('@/components/SearchInput/SearchWhereInput', () => {
  const Input = jest.requireActual(
    '@/components/InputControlled',
  ).TextInputControlled;
  return ({ control }: { control: unknown }) => (
    <Input control={control} name="where" label="Query" />
  );
});

describe('NetFlow draft search fields', () => {
  it('preserves drafts until Run when clicks or migrations update filters', async () => {
    renderWithMantine(<NetflowPage />);
    const query = await screen.findByLabelText('Query');
    const protocol = screen.getByLabelText('Protocol');
    fireEvent.change(query, { target: { value: 'DstPort:443' } });
    fireEvent.change(protocol, { target: { value: '17' } });
    const filters: Filter[] = [
      { type: 'sql', condition: "ExporterName = 'edge-a'" },
    ];
    act(() => mockFilterChange(filters));
    await waitFor(() =>
      expect(
        jest.mocked(buildNetflowQueryConfigs).mock.lastCall?.[0],
      ).toMatchObject({
        where: 'Proto:6',
        filters: { protocol: '' },
        extraFilters: filters,
      }),
    );
    expect(query).toHaveValue('DstPort:443');
    expect(protocol).toHaveValue('17');
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() =>
      expect(
        jest.mocked(buildNetflowQueryConfigs).mock.lastCall?.[0],
      ).toMatchObject({
        where: 'DstPort:443',
        filters: { protocol: '17' },
        extraFilters: filters,
      }),
    );
  });
});
