import { act } from 'react';
import { Control, useForm, useWatch } from 'react-hook-form';
import type { Filter } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';

import { ChartEditorFormState } from '@/components/ChartEditor/types';
import { ChartSeriesEditor } from '@/components/DBEditTimeChartForm/ChartSeriesEditor';
import type { FilterStateHook } from '@/searchFilters';

// Both filter inputs pull in CodeMirror and the ClickHouse metadata hooks.
// This suite is about which of them the series card reaches for, so they stand
// in for themselves.
jest.mock('@/components/SearchInput/SearchWhereInput', () => ({
  __esModule: true,
  default: () => <div data-testid="search-where-input" />,
}));

let seriesQueryEditorFilters: FilterStateHook | undefined;

jest.mock('@/components/Explore/ExploreQueryEditor', () => ({
  ExploreQueryEditor: ({
    searchFilters,
  }: {
    searchFilters?: FilterStateHook;
  }) => {
    seriesQueryEditorFilters = searchFilters;
    return <div data-testid="explore-query-editor" />;
  },
}));

jest.mock('@/hooks/useFetchMetricResourceAttrs', () => ({
  useFetchMetricResourceAttrs: () => ({ data: [], isLoading: false }),
  parseAttributeKeysFromSuggestions: () => [],
}));

jest.mock('@/hooks/useFetchMetricMetadata', () => ({
  useFetchMetricMetadata: () => ({ data: undefined }),
}));

const noop = () => {};

function SeriesFiltersProbe({
  control,
  onChange,
}: {
  control: Control<ChartEditorFormState>;
  onChange: (filters: Filter[] | undefined) => void;
}) {
  onChange(useWatch({ control, name: 'series.0.filters' }));
  return null;
}

function Harness({
  sharedWhere,
  useQueryEditor,
  filters,
  onSubmit = noop,
  onSeriesChange,
}: {
  sharedWhere?: string;
  useQueryEditor?: boolean;
  filters?: Filter[];
  onSubmit?: () => void;
  onSeriesChange?: (filters: Filter[] | undefined) => void;
}) {
  const { control, setValue, clearErrors } = useForm<ChartEditorFormState>({
    defaultValues: {
      series: [
        {
          aggFn: 'count',
          aggCondition: '',
          valueExpression: '',
          ...(filters != null ? { filters } : {}),
        },
      ],
    },
  });

  return (
    <>
      {onSeriesChange != null && (
        <SeriesFiltersProbe control={control} onChange={onSeriesChange} />
      )}
      <ChartSeriesEditor
        control={control}
        databaseName="default"
        index={0}
        namePrefix="series.0."
        length={1}
        onRemoveSeries={jest.fn()}
        onSwapSeries={jest.fn()}
        onDuplicateSeries={jest.fn()}
        onSubmit={onSubmit}
        setValue={setValue}
        clearErrors={clearErrors}
        showGroupBy={false}
        showHaving={false}
        showDuplicate={false}
        showColor={false}
        tableName="otel_logs"
        sharedWhere={sharedWhere}
        useQueryEditor={useQueryEditor}
      />
    </>
  );
}

describe('ChartSeriesEditor', () => {
  it('labels the series filter Where when nothing else narrows the chart', () => {
    renderWithMantine(<Harness />);

    expect(screen.getByText('Where')).toBeInTheDocument();
  });

  it('reads as an addition to the chart search when one is already applied', () => {
    renderWithMantine(<Harness sharedWhere="ServiceName = 'checkout'" />);

    expect(screen.getByText('And where')).toBeInTheDocument();
  });

  it('ignores a blank chart search, which narrows nothing', () => {
    renderWithMantine(<Harness sharedWhere="   " />);

    expect(screen.getByText('Where')).toBeInTheDocument();
  });

  it('filters a dashboard tile series with the language-switching input', () => {
    renderWithMantine(<Harness />);

    expect(screen.getByTestId('search-where-input')).toBeInTheDocument();
    expect(screen.queryByTestId('explore-query-editor')).toBeNull();
  });

  it('filters an Explore series with the same query editor as the page bar', () => {
    renderWithMantine(<Harness useQueryEditor />);

    expect(screen.getByTestId('explore-query-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('search-where-input')).toBeNull();
  });

  it('gives an Explore series its own filter state so clauses can promote', () => {
    renderWithMantine(<Harness useQueryEditor />);

    expect(seriesQueryEditorFilters).toBeDefined();
  });

  it('leaves a dashboard tile series without one, since it has nowhere to put pills', () => {
    seriesQueryEditorFilters = undefined;
    renderWithMantine(<Harness />);

    expect(seriesQueryEditorFilters).toBeUndefined();
  });

  it('reads pills already on the series', () => {
    renderWithMantine(
      <Harness
        useQueryEditor
        filters={[{ type: 'sql', condition: "level IN ('error')" }]}
      />,
    );

    expect(seriesQueryEditorFilters?.filters.level.included).toEqual(
      new Set(['error']),
    );
  });

  it('writes a promoted clause back onto the series and re-runs the query', () => {
    const onSubmit = jest.fn();
    let seriesFilters: Filter[] | undefined;
    renderWithMantine(
      <Harness
        useQueryEditor
        onSubmit={onSubmit}
        onSeriesChange={next => {
          seriesFilters = next;
        }}
      />,
    );

    act(() => {
      seriesQueryEditorFilters?.setFilterValue('level', 'error');
    });

    expect(seriesFilters).toEqual([
      { type: 'sql', condition: "level IN ('error')" },
    ]);
    expect(onSubmit).toHaveBeenCalled();
  });
});
