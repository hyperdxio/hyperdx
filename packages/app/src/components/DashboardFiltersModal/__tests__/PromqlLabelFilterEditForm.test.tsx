import { useForm, useWatch } from 'react-hook-form';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  FilterFormControl,
  FilterFormValues,
  toFormValues,
} from '@/components/DashboardFiltersModal/filterFormState';
import { PromqlLabelFilterEditForm } from '@/components/DashboardFiltersModal/PromqlLabelFilterEditForm';

const mockLabels = jest.fn();
let mockSourcesData: Partial<TSource>[];

jest.mock('@/api', () => ({
  prometheusApi: {
    labels: (...args: unknown[]) => mockLabels(...args),
  },
}));
jest.mock('@/source', () => ({
  useSources: () => ({ data: mockSourcesData, isLoading: false }),
}));
// The real selector renders inside a portal and reads connection metadata;
// a plain input bound to the same field is enough to drive the label lookup.
jest.mock('@/components/SourceSelect', () => ({
  SourceSelectControlled: ({
    control,
    name,
  }: {
    control: FilterFormControl;
    name: 'source';
  }) => <input data-testid="source-selector" {...control.register(name)} />,
}));

// Mantine's Combobox calls scrollIntoView when its dropdown opens; jsdom lacks it.
window.HTMLElement.prototype.scrollIntoView = jest.fn();

const PROMQL_SOURCE: Partial<TSource> = {
  id: 'promql-source',
  kind: SourceKind.Promql,
  name: 'Prometheus',
  connection: 'clickhouse-conn',
  from: { databaseName: 'telemetry', tableName: 'metrics' },
};

function Harness({ sourceId }: { sourceId?: string }) {
  const { control } = useForm<FilterFormValues>({
    defaultValues: toFormValues(undefined, sourceId),
  });
  const label = useWatch({ control, name: 'label' });
  return (
    <>
      <PromqlLabelFilterEditForm control={control} otherFilters={[]} />
      <div data-testid="label-value">{label}</div>
    </>
  );
}

const renderForm = (sourceId?: string) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  renderWithMantine(
    <QueryClientProvider client={queryClient}>
      <Harness sourceId={sourceId} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
};

describe('PromqlLabelFilterEditForm', () => {
  beforeEach(() => {
    mockSourcesData = [PROMQL_SOURCE];
    mockLabels.mockReset();
    mockLabels.mockResolvedValue({
      status: 'success',
      data: ['__name__', 'instance', 'job'],
    });
  });

  it('suggests the label names of the selected source', async () => {
    const user = renderForm('promql-source');

    await user.click(screen.getByTestId('filter-label-input'));

    expect(await screen.findByText('instance')).toBeInTheDocument();
    expect(screen.getByText('job')).toBeInTheDocument();
    expect(mockLabels).toHaveBeenCalledWith({
      connectionId: 'clickhouse-conn',
      database: 'telemetry',
      table: 'metrics',
    });
  });

  it('selecting a suggestion sets the label', async () => {
    const user = renderForm('promql-source');

    await user.click(screen.getByTestId('filter-label-input'));
    await user.click(await screen.findByText('job'));

    expect(screen.getByTestId('label-value')).toHaveTextContent('job');
  });

  it('accepts a label that is not suggested', async () => {
    const user = renderForm('promql-source');

    await user.type(screen.getByTestId('filter-label-input'), 'pod');

    expect(screen.getByTestId('label-value')).toHaveTextContent('pod');
  });

  it('does not look up labels until a source is chosen', async () => {
    const user = renderForm();

    await user.click(screen.getByTestId('filter-label-input'));

    await waitFor(() => expect(mockLabels).not.toHaveBeenCalled());
    expect(screen.queryByText('job')).toBeNull();
  });
});
