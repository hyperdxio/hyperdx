import { useForm, useWatch } from 'react-hook-form';
import { MetricsDataType, TSource } from '@hyperdx/common-utils/dist/types';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useTablesDirect } from '@/clickhouse';
import { DEFAULT_DATABASE } from '@/components/Sources/SourceForm/constants';
import { MetricTableModelForm } from '@/components/Sources/SourceForm/MetricTableModelForm';
import { isValidMetricTable } from '@/source';

jest.mock('@/clickhouse', () => ({
  useTablesDirect: jest.fn(),
}));
jest.mock('@/source', () => ({
  isValidMetricTable: jest.fn(),
}));
jest.mock('@/api', () => ({
  __esModule: true,
  default: { useTeam: () => ({ data: {} }) },
}));
// The real hook keeps its metadata instance in state, so it's stable across
// renders; a fresh instance per render would restart the autofill effect.
const metadata = {};
jest.mock('@/hooks/useMetadata', () => ({
  useMetadataWithSettings: () => metadata,
}));
jest.mock('@/hooks/useMetricsSeriesTableAvailability', () => ({
  useMetricsSeriesTableAvailability: () => ({ status: 'unavailable' }),
}));
// The table/source pickers query ClickHouse and Mongo; the inference logic
// under test only reads and writes form values, so stub them out.
jest.mock('@/components/DBTableSelect', () => ({
  DBTableSelectControlled: () => null,
}));
jest.mock('@/components/SourceSelect', () => ({
  SourceSelectControlled: () => null,
}));

const asMock = (fn: unknown) => fn as jest.Mock;

const OTHER_DB = 'other_db';
const CONNECTION_ID = 'conn-1';
const savedKey = `${DEFAULT_DATABASE}:${CONNECTION_ID}`;

// Both databases hold recognizable OTel metric tables, so a match exists either
// way and only the guard decides whether inference fires. Gauge is the table the
// saved source already has; sum is the one inference would fill in.
const TABLES_BY_DB: Record<string, string[]> = {
  [DEFAULT_DATABASE]: ['otel_metrics_gauge', 'otel_metrics_sum'],
  [OTHER_DB]: ['other_metrics_gauge', 'other_metrics_sum'],
};

/**
 * Stands in for the source form when editing a saved metric source: the gauge
 * table is set and sum is left empty, so inference has something to fill.
 * The button switches the database the way the Database dropdown does.
 */
function Harness({ savedMetricTablesKey }: { savedMetricTablesKey?: string }) {
  const { control, setValue } = useForm<TSource>({
    defaultValues: {
      connection: CONNECTION_ID,
      from: { databaseName: DEFAULT_DATABASE, tableName: '' },
      metricTables: {
        [MetricsDataType.Gauge]: 'otel_metrics_gauge',
      },
    } as Partial<TSource>,
  });
  const metricTables = useWatch({ control, name: 'metricTables' });

  return (
    <>
      <MetricTableModelForm
        control={control}
        setValue={setValue}
        savedMetricTablesKey={savedMetricTablesKey}
      />
      <button onClick={() => setValue('from.databaseName', OTHER_DB)}>
        switch db
      </button>
      <output data-testid="sum">
        {(metricTables as Record<string, string> | undefined)?.[
          MetricsDataType.Sum
        ] ?? ''}
      </output>
    </>
  );
}

// Inference validates each candidate before writing it, so let effects and
// their awaited validations settle before asserting nothing happened.
async function flushInference() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // One stable result object per database, mirroring react-query's referential
  // stability — a fresh object per render would restart the autofill effect.
  const results = new Map<string, unknown>();
  asMock(useTablesDirect).mockImplementation(
    ({ database }: { database: string }) => {
      if (!results.has(database)) {
        results.set(database, {
          data: {
            data: (TABLES_BY_DB[database] ?? []).map(name => ({ name })),
          },
        });
      }
      return results.get(database);
    },
  );
  asMock(isValidMetricTable).mockResolvedValue(true);
});

describe('MetricTableModelForm metric table inference guard', () => {
  it('infers the missing table when there are no saved metric tables', async () => {
    renderWithMantine(<Harness />);

    await waitFor(() =>
      expect(screen.getByTestId('sum')).toHaveTextContent('otel_metrics_sum'),
    );
  });

  it('does not infer for the db/connection the saved tables came from', async () => {
    renderWithMantine(<Harness savedMetricTablesKey={savedKey} />);

    // Identical mocks to the test above, which proves inference does fire for
    // this database — so an empty sum here is the guard, not an unready form.
    await flushInference();

    expect(isValidMetricTable).not.toHaveBeenCalled();
    expect(screen.getByTestId('sum')).toHaveTextContent('');
  });

  it('resumes inference after the user switches to another database', async () => {
    renderWithMantine(<Harness savedMetricTablesKey={savedKey} />);
    await flushInference();

    await userEvent.click(screen.getByRole('button', { name: 'switch db' }));

    // Another database is a different pair from the one the source was saved
    // with, so there are no saved-but-hidden tables to protect.
    await waitFor(() =>
      expect(screen.getByTestId('sum')).toHaveTextContent('other_metrics_sum'),
    );
  });
});
