import { useEffect, useState } from 'react';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { screen, waitFor } from '@testing-library/react';

import DBHeatmapChart from '@/components/DBHeatmapChart';

// DBHeatmapChart's default export is a `dynamic()` wrapper; render its inner
// component once the loader resolves.
jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: (loader: () => Promise<unknown>) => {
    const Wrapped = (props: any) => {
      const [Component, setComponent] = useState<React.ComponentType | null>(
        null,
      );
      useEffect(() => {
        let active = true;
        loader().then((mod: any) => {
          if (active) setComponent(() => mod?.default ?? mod);
        });
        return () => {
          active = false;
        };
      }, []);
      return Component ? <Component {...props} /> : null;
    };
    return Wrapped;
  },
}));

jest.mock('uplot-react', () => ({
  __esModule: true,
  default: () => <div data-testid="heatmap-plot" />,
}));

const mockUseQueriedChartConfig = jest.fn();
jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: (...args: unknown[]) =>
    mockUseQueriedChartConfig(...args),
}));

const T0 = new Date('2026-07-06T00:00:00Z');
const T1 = new Date('2026-07-06T02:00:00Z');

const config: React.ComponentProps<typeof DBHeatmapChart>['config'] = {
  displayType: DisplayType.Heatmap,
  select: [{ aggFn: 'heatmap', valueExpression: 'Duration' }],
  from: { databaseName: 'default', tableName: 'otel_traces' },
  where: '',
  dateRange: [T0, T1],
  granularity: 'auto',
  timestampValueExpression: 'Timestamp',
  connection: 'test-connection',
};

const bucketData = {
  meta: [
    { name: '__hdx_time_bucket', type: 'DateTime' },
    { name: 'x_bucket', type: 'UInt32' },
    { name: 'count', type: 'UInt64' },
  ],
  data: [
    { __hdx_time_bucket: '2026-07-06T00:00:00Z', x_bucket: 1, count: '5' },
    { __hdx_time_bucket: '2026-07-06T01:00:00Z', x_bucket: 2, count: '3' },
  ],
};

// The heatmap runs two queries: the bounds (`heatmap`) and the buckets
// (`heatmap_bucket`). Route each call to its own result.
function mockQueries({
  boundsPlaceholder,
  bucketsPlaceholder,
}: {
  boundsPlaceholder: boolean;
  bucketsPlaceholder: boolean;
}) {
  mockUseQueriedChartConfig.mockImplementation((_config, options) =>
    options?.queryKey?.includes('heatmap')
      ? {
          data: { data: [{ min: '1', max: '100' }], meta: [] },
          isLoading: false,
          isPlaceholderData: boundsPlaceholder,
          error: null,
        }
      : {
          data: bucketData,
          isLoading: false,
          isPlaceholderData: bucketsPlaceholder,
          error: null,
        },
  );
}

function optionsFor(queryName: string) {
  const call = mockUseQueriedChartConfig.mock.calls.find(([, options]) =>
    options?.queryKey?.includes(queryName),
  );
  return call?.[1];
}

describe('DBHeatmapChart refresh', () => {
  beforeEach(() => {
    mockUseQueriedChartConfig.mockReset();
  });

  it('keeps both queries on their previous data while a refresh loads', async () => {
    mockQueries({ boundsPlaceholder: false, bucketsPlaceholder: false });

    renderWithMantine(<DBHeatmapChart config={config} />);
    await screen.findByTestId('heatmap-plot');

    const previous = { data: [] };
    expect(optionsFor('heatmap')?.placeholderData?.(previous)).toBe(previous);
    expect(optionsFor('heatmap_bucket')?.placeholderData?.(previous)).toBe(
      previous,
    );
  });

  it('keeps the previous heatmap on screen and pulses while a refresh loads', async () => {
    mockQueries({ boundsPlaceholder: true, bucketsPlaceholder: true });

    renderWithMantine(<DBHeatmapChart config={config} />);

    const plot = await screen.findByTestId('heatmap-plot');
    expect(plot.closest('.heatmap-selection-container')).toHaveClass(
      'effect-pulse',
    );
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });

  it('does not pulse once fresh data has loaded', async () => {
    mockQueries({ boundsPlaceholder: false, bucketsPlaceholder: false });

    renderWithMantine(<DBHeatmapChart config={config} />);

    const plot = await screen.findByTestId('heatmap-plot');
    expect(plot.closest('.heatmap-selection-container')).not.toHaveClass(
      'effect-pulse',
    );
  });

  it('holds the bucket query until the refreshed bounds arrive', async () => {
    mockQueries({ boundsPlaceholder: true, bucketsPlaceholder: true });
    const { unmount } = renderWithMantine(<DBHeatmapChart config={config} />);
    await screen.findByTestId('heatmap-plot');
    expect(optionsFor('heatmap_bucket')?.enabled).toBe(false);
    unmount();

    mockUseQueriedChartConfig.mockReset();
    mockQueries({ boundsPlaceholder: false, bucketsPlaceholder: true });
    renderWithMantine(<DBHeatmapChart config={config} />);
    await waitFor(() =>
      expect(optionsFor('heatmap_bucket')?.enabled).toBe(true),
    );
  });
});
