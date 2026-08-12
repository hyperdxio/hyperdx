import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { fromPartial } from '@total-typescript/shoehorn';
import { MantineProvider } from '@mantine/core';
import { render, waitFor } from '@testing-library/react';

import { MetricTableModelForm } from '@/components/Sources/SourceForm/MetricTableModelForm';

import '@testing-library/jest-dom';

// Table lists per database, used by the mocked `useTablesDirect`.
const TABLES_BY_DB: Record<string, string[]> = {
  default: ['otel_metrics_gauge', 'otel_metrics_sum'],
  otel_v2: ['otel_metrics_gauge', 'otel_metrics_sum', 'otel_metrics_histogram'],
  other_db: [
    'other_metrics_gauge',
    'other_metrics_sum',
    'other_metrics_histogram',
  ],
};

let savedSource: TSource | undefined;

jest.mock('@/api', () => ({
  useTeam: () => ({ data: { isMetricsSeriesTableEnabled: false } }),
}));

jest.mock('@/clickhouse', () => ({
  useTablesDirect: ({ database }: { database: string }) => ({
    data: {
      data: (TABLES_BY_DB[database] ?? []).map(name => ({ name })),
    },
  }),
}));

jest.mock('@/hooks/useMetadata', () => ({
  useMetadataWithSettings: () => ({}),
}));

jest.mock('@/hooks/useMetricsSeriesTableAvailability', () => ({
  useMetricsSeriesTableAvailability: () => ({
    status: 'disabled',
    missingSeriesHashTables: [],
  }),
}));

jest.mock('@/source', () => ({
  isValidMetricTable: jest.fn(() => Promise.resolve(true)),
  useSource: ({ id }: { id?: string }) => ({
    data: id ? savedSource : undefined,
  }),
}));

jest.mock('@/theme/ThemeProvider', () => ({
  useBrandDisplayName: () => 'HyperDX',
}));

jest.mock('@mantine/notifications', () => ({
  notifications: { show: jest.fn() },
}));

jest.mock('@/components/DBTableSelect', () => ({
  DBTableSelectControlled: ({ name }: { name: string }) => <div>{name}</div>,
}));

jest.mock('@/components/SourceSelect', () => ({
  SourceSelectControlled: () => <div />,
}));

const mockSetValue = jest.fn();

// Rendered with a wrapper rather than the global `renderWithMantine` helper so
// that `rerender` keeps the provider (and the component instance) in place.
function renderHarness(ui: React.ReactElement) {
  return render(ui, {
    wrapper: ({ children }) => <MantineProvider>{children}</MantineProvider>,
  });
}

function Harness({
  databaseName,
  metricTables,
  sourceId,
}: {
  databaseName: string;
  metricTables?: Record<string, string>;
  sourceId?: string;
}) {
  const { control, setValue } = useForm<TSource>({
    defaultValues: {
      kind: SourceKind.Metric,
      connection: 'conn-1',
      from: { databaseName, tableName: '' },
      metricTables,
    },
  });

  // Mirrors how SourceForm's watched database changes — either from the user
  // picking one, or from the saved source landing in the form.
  useEffect(() => {
    setValue('from.databaseName', databaseName);
  }, [databaseName, setValue]);

  return (
    <MetricTableModelForm
      control={control}
      setValue={mockSetValue}
      sourceId={sourceId}
    />
  );
}

// The component also pushes the fixed OTEL expressions through setValue; only
// the table fields are autofill.
function autofilledTables() {
  return mockSetValue.mock.calls
    .filter(
      ([path]) =>
        typeof path === 'string' &&
        (path.startsWith('metricTables.') || path === 'seriesTable'),
    )
    .map(([path, value]) => [path, value]);
}

const SAVED_SOURCE = fromPartial<TSource>({
  id: 'metric-source-1',
  kind: SourceKind.Metric,
  name: 'Metrics',
  connection: 'conn-1',
  from: { databaseName: 'otel_v2', tableName: '' },
  timestampValueExpression: 'TimeUnix',
  metricTables: {
    gauge: 'otel_metrics_gauge',
    sum: 'otel_metrics_sum',
  },
}) as TSource;

describe('MetricTableModelForm metric table autofill', () => {
  beforeEach(() => {
    mockSetValue.mockClear();
    savedSource = undefined;
  });

  it('autofills tables for a new source', async () => {
    renderHarness(<Harness databaseName="default" />);

    await waitFor(() => {
      expect(autofilledTables()).toEqual(
        expect.arrayContaining([
          ['metricTables.gauge', 'otel_metrics_gauge'],
          ['metricTables.sum', 'otel_metrics_sum'],
        ]),
      );
    });
  });

  it('autofills when a new source switches database', async () => {
    const { rerender } = renderHarness(<Harness databaseName="default" />);

    await waitFor(() => {
      expect(autofilledTables().length).toBeGreaterThan(0);
    });
    mockSetValue.mockClear();

    rerender(<Harness databaseName="otel_v2" />);

    await waitFor(() => {
      expect(autofilledTables()).toEqual(
        expect.arrayContaining([
          ['metricTables.histogram', 'otel_metrics_histogram'],
        ]),
      );
    });
  });

  it('does not autofill when opening an existing configured source', async () => {
    // Saved source hasn't loaded yet, so the form still shows the new-source
    // default database — autofill must not fire against it.
    const { rerender } = renderHarness(
      <Harness databaseName="default" sourceId="metric-source-1" />,
    );
    await waitFor(() => {
      expect(mockSetValue).toHaveBeenCalled(); // OTEL expressions applied
    });
    expect(autofilledTables()).toEqual([]);

    // Saved source arrives and the form resets to its saved values.
    savedSource = SAVED_SOURCE;
    rerender(
      <Harness
        databaseName="otel_v2"
        metricTables={{ gauge: 'otel_metrics_gauge', sum: 'otel_metrics_sum' }}
        sourceId="metric-source-1"
      />,
    );

    // `otel_v2` has an unconfigured histogram table, but opening the source
    // must leave the form untouched.
    await waitFor(() => {
      expect(autofilledTables()).toEqual([]);
    });
  });

  it('autofills when an existing configured source switches database', async () => {
    savedSource = SAVED_SOURCE;
    const { rerender } = renderHarness(
      <Harness
        databaseName="otel_v2"
        metricTables={{ gauge: 'otel_metrics_gauge', sum: 'otel_metrics_sum' }}
        sourceId="metric-source-1"
      />,
    );

    await waitFor(() => {
      expect(mockSetValue).toHaveBeenCalled();
    });
    expect(autofilledTables()).toEqual([]);

    // Switching database fills the metric types that are still unset. Types
    // the user already configured are never overwritten.
    rerender(
      <Harness
        databaseName="other_db"
        metricTables={{ gauge: 'otel_metrics_gauge', sum: 'otel_metrics_sum' }}
        sourceId="metric-source-1"
      />,
    );

    await waitFor(() => {
      expect(autofilledTables()).toEqual([
        ['metricTables.histogram', 'other_metrics_histogram'],
      ]);
    });
  });

  // A saved source of another kind switched over to OTEL Metrics has no metric
  // tables to preserve, so it autofills like a new source.
  it('autofills for an existing source switched to the metrics kind', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    savedSource = fromPartial<TSource>({
      ...SAVED_SOURCE,
      kind: SourceKind.Log,
      metricTables: undefined,
    }) as TSource;

    renderHarness(
      <Harness databaseName="otel_v2" sourceId="metric-source-1" />,
    );

    await waitFor(() => {
      expect(autofilledTables()).toEqual(
        expect.arrayContaining([
          ['metricTables.gauge', 'otel_metrics_gauge'],
          ['metricTables.histogram', 'otel_metrics_histogram'],
          ['metricTables.sum', 'otel_metrics_sum'],
        ]),
      );
    });
  });
});
