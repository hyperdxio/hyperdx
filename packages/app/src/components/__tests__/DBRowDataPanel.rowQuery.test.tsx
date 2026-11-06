import type { ResponseJSON } from '@hyperdx/common-utils/dist/clickhouse';
import { SourceKind, TLogSource } from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';

import { RowDataPanel, useRowData } from '@/components/DBRowDataPanel';

const mockQueryChartConfig = jest.fn();
jest.mock('@/clickhouse', () => ({
  useClickhouseClient: () => ({ queryChartConfig: mockQueryChartConfig }),
}));
jest.mock('@/hooks/useMetadata', () => ({
  useColumns: () => ({ data: undefined, isLoading: false }),
  useMetadataWithSettings: () => ({}),
}));
jest.mock('@/hooks/useMVOptimizationExplanation', () => ({
  useMVOptimizationExplanation: () => ({ data: undefined, isLoading: false }),
}));
jest.mock('@/source', () => ({
  ...jest.requireActual('@/source'),
  useSource: () => ({ data: undefined, isLoading: false }),
}));
// Records the row the tab renders.
const mockJsonViewerData = jest.fn();
jest.mock('@/components/DBRowJsonViewer', () => ({
  DBRowJsonViewer: ({ data }: { data: unknown }) => {
    mockJsonViewerData(data);
    return null;
  },
}));

const source: TLogSource = {
  id: 'source-id',
  kind: SourceKind.Log,
  name: 'logs',
  connection: 'conn-id',
  from: { databaseName: 'default', tableName: 'logs' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Timestamp, Body',
  bodyExpression: 'Body',
};

const DATE_RANGE: [Date, Date] = [
  new Date('2024-01-01T00:00:00Z'),
  new Date('2024-01-01T02:00:00Z'),
];

const found: ResponseJSON<Record<string, unknown>> = {
  data: [{ Body: 'hello' }],
  meta: [{ name: 'Body', type: 'String' }],
  rows: 1,
};

type PanelProps = {
  source: TLogSource;
  rowId: string;
  dateRange?: [Date, Date];
};

// Mirrors DBRowSidePanel: the panel shows "Loading..." until its own lookup of
// the row settles, then mounts the tab, which looks up the same row again.
function SidePanel(props: PanelProps) {
  const { isLoading } = useRowData(props);
  if (isLoading) {
    return <div>Loading...</div>;
  }
  return <RowDataPanel {...props} data-testid="tab" />;
}

describe('row lookup', () => {
  // The app's QueryClient uses React Query's defaults (pages/_app.tsx).
  let queryClient: QueryClient;

  function renderPanel(props: PanelProps) {
    const tree = (panelProps: PanelProps) => (
      <MantineProvider>
        <QueryClientProvider client={queryClient}>
          <SidePanel {...panelProps} />
        </QueryClientProvider>
      </MantineProvider>
    );
    const result = render(tree(props));
    return {
      rerender: (next: PanelProps) => result.rerender(tree(next)),
      unmount: result.unmount,
    };
  }

  async function settled() {
    await screen.findByTestId('tab');
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  }

  beforeEach(() => {
    queryClient = new QueryClient();
    mockQueryChartConfig.mockReset().mockResolvedValue(found);
    mockJsonViewerData.mockReset();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it.each<{ lookup: string; dateRange?: [Date, Date] }>([
    { lookup: 'unbounded' },
    { lookup: 'bounded', dateRange: DATE_RANGE },
  ])(
    'runs the $lookup lookup once for the panel and its tab',
    async ({ dateRange }) => {
      renderPanel({ source, rowId: "id='a'", dateRange });
      await settled();

      expect(mockQueryChartConfig).toHaveBeenCalledTimes(1);
      expect(mockJsonViewerData).toHaveBeenLastCalledWith({ Body: 'hello' });
    },
  );

  it('reuses a found row when the panel opens it again', async () => {
    const first = renderPanel({ source, rowId: "id='a'" });
    await settled();
    first.unmount();

    renderPanel({ source, rowId: "id='a'" });
    await settled();

    expect(mockQueryChartConfig).toHaveBeenCalledTimes(1);
    expect(mockJsonViewerData).toHaveBeenLastCalledWith({ Body: 'hello' });
  });

  it('runs again for another row', async () => {
    const { rerender } = renderPanel({ source, rowId: "id='a'" });
    await settled();
    rerender({ source, rowId: "id='b'" });
    await settled();

    expect(
      mockQueryChartConfig.mock.calls.map(([{ config }]) => config.where),
    ).toEqual(["id='a'", "id='b'"]);
  });

  it('runs again for another source', async () => {
    const { rerender } = renderPanel({ source, rowId: "id='a'" });
    await settled();
    rerender({
      source: { ...source, from: { ...source.from, tableName: 'logs_v2' } },
      rowId: "id='a'",
    });
    await settled();

    expect(
      mockQueryChartConfig.mock.calls.map(
        ([{ config }]) => config.from.tableName,
      ),
    ).toEqual(['logs', 'logs_v2']);
  });

  it('runs again for a row it did not find', async () => {
    mockQueryChartConfig.mockResolvedValue({ data: [], meta: [], rows: 0 });

    renderPanel({ source, rowId: "id='a'" });
    await settled();

    expect(mockQueryChartConfig).toHaveBeenCalledTimes(2);
  });
});
