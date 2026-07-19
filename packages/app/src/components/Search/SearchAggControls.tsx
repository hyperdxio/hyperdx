import { useCallback, useMemo } from 'react';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { Group, NumberInput, Select, Text, TextInput } from '@mantine/core';

import type { SearchView } from './searchViews';

type AggFn =
  | 'count'
  | 'count_distinct'
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'p50'
  | 'p90'
  | 'p95'
  | 'p99';

const AGG_FN_OPTIONS: { value: AggFn; label: string }[] = [
  { value: 'count', label: 'Count' },
  { value: 'count_distinct', label: 'Count distinct' },
  { value: 'sum', label: 'Sum' },
  { value: 'avg', label: 'Avg' },
  { value: 'min', label: 'Min' },
  { value: 'max', label: 'Max' },
  { value: 'p50', label: 'p50' },
  { value: 'p90', label: 'p90' },
  { value: 'p95', label: 'p95' },
  { value: 'p99', label: 'p99' },
];

const DEFAULT_AGG_LIMIT = 20;

export type AggSortField = 'value' | 'name';
type AggSortDirection = 'asc' | 'desc';

export interface SearchAggConfig {
  aggFn: AggFn;
  aggExpr: string;
  groupBy: string;
  limit: number;
  sort: AggSortField;
  sortDir: AggSortDirection;
}

/** URL-backed aggregation config for the search view switcher. */
export function useSearchAggConfig(): [
  SearchAggConfig,
  (patch: Partial<SearchAggConfig>) => void,
] {
  const [state, setState] = useQueryStates({
    agg: parseAsString.withDefault('count'),
    aggExpr: parseAsString.withDefault(''),
    groupBy: parseAsString.withDefault(''),
    limit: parseAsInteger.withDefault(DEFAULT_AGG_LIMIT),
    sort: parseAsString.withDefault('value'),
    sortDir: parseAsString.withDefault('desc'),
  });

  const config = useMemo<SearchAggConfig>(
    () => ({
      aggFn: state.agg as AggFn,
      aggExpr: state.aggExpr,
      groupBy: state.groupBy,
      limit: state.limit,
      sort: state.sort as AggSortField,
      sortDir: state.sortDir as AggSortDirection,
    }),
    [
      state.agg,
      state.aggExpr,
      state.groupBy,
      state.limit,
      state.sort,
      state.sortDir,
    ],
  );

  const setConfig = useCallback(
    (patch: Partial<SearchAggConfig>) => {
      setState({
        ...(patch.aggFn != null ? { agg: patch.aggFn } : {}),
        ...(patch.aggExpr != null ? { aggExpr: patch.aggExpr } : {}),
        ...(patch.groupBy != null ? { groupBy: patch.groupBy } : {}),
        ...(patch.limit != null ? { limit: patch.limit } : {}),
        ...(patch.sort != null ? { sort: patch.sort } : {}),
        ...(patch.sortDir != null ? { sortDir: patch.sortDir } : {}),
      });
    },
    [setState],
  );

  return [config, setConfig];
}

export function SearchAggControls({
  view,
  config,
  onChange,
  defaultGroupBy,
  onSubmit,
}: {
  view: SearchView;
  config: SearchAggConfig;
  onChange: (patch: Partial<SearchAggConfig>) => void;
  defaultGroupBy?: string;
  onSubmit: () => void;
}) {
  const needsExpr = config.aggFn !== 'count';
  // Number collapses to a single value: no group-by / limit.
  const showGroupBy = view !== 'number';
  const showLimit =
    view === 'table' || view === 'bar' || view === 'pie' || view === 'treemap';

  return (
    <Group
      gap="xs"
      align="center"
      wrap="wrap"
      px="sm"
      py={6}
      data-testid="search-agg-controls"
    >
      <Text size="xs" c="dimmed">
        Aggregate
      </Text>
      <Select
        size="xs"
        w={140}
        data={AGG_FN_OPTIONS}
        value={config.aggFn}
        allowDeselect={false}
        onChange={value => {
          if (value) {
            onChange({ aggFn: value as AggFn });
            onSubmit();
          }
        }}
        comboboxProps={{ withinPortal: true }}
      />
      {needsExpr && (
        <TextInput
          size="xs"
          w={200}
          placeholder="value expression (e.g. Duration)"
          defaultValue={config.aggExpr}
          onBlur={e => {
            onChange({ aggExpr: e.currentTarget.value });
            onSubmit();
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              onChange({ aggExpr: e.currentTarget.value });
              onSubmit();
            }
          }}
        />
      )}
      {showGroupBy && (
        <>
          <Text size="xs" c="dimmed">
            grouped by
          </Text>
          <TextInput
            size="xs"
            w={220}
            placeholder={defaultGroupBy || 'SQL column'}
            defaultValue={config.groupBy}
            onBlur={e => {
              onChange({ groupBy: e.currentTarget.value });
              onSubmit();
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                onChange({ groupBy: e.currentTarget.value });
                onSubmit();
              }
            }}
          />
        </>
      )}
      {showLimit && (
        <>
          <Text size="xs" c="dimmed">
            top
          </Text>
          <NumberInput
            size="xs"
            w={90}
            min={1}
            max={1000}
            value={config.limit}
            onChange={value => {
              onChange({
                limit: typeof value === 'number' ? value : DEFAULT_AGG_LIMIT,
              });
              onSubmit();
            }}
          />
        </>
      )}
    </Group>
  );
}
