import { useEffect, useMemo, useRef } from 'react';
import {
  FilterState,
  filtersToQuery,
  isRenderablePinnedFilter,
  parseQuery,
} from '@hyperdx/common-utils/dist/filters';
import {
  BuilderChartConfigWithDateRange,
  Filter,
  TNetflowSource,
} from '@hyperdx/common-utils/dist/types';

import { getNetflowDimensions, NETFLOW_DIMENSION_LABELS } from '@/netflow';
import {
  sankeyDimensionExpression,
  SankeyFilterHandler,
  unwrapSankeyDimensionExpression,
} from '@/netflowSankey';
import { useSearchPageFilterState } from '@/searchFilters';

import { cleanClickHouseExpression } from './DBSearchPageFilters/utils';
import { ActiveFilterPills } from './ActiveFilterPills';
import { NetflowFilterHandler } from './NetflowFilterMenu';

// Table and Sankey filters can wrap the same mapped field in different SQL expressions.
function canonicalizeMappedFilters(
  filters: Filter[],
  expressions: Map<string, string>,
): Filter[] {
  const mapped: FilterState = {};
  const remaining: Filter[] = [];
  let migrated = false;
  for (const filter of filters) {
    if (!isRenderablePinnedFilter(filter)) {
      remaining.push(filter);
      continue;
    }
    const [entry] = Object.entries(parseQuery([filter]).filters);
    const canonical =
      entry && expressions.get(cleanClickHouseExpression(entry[0]));
    if (!canonical) {
      remaining.push(filter);
      continue;
    }
    const [key, values] = entry;
    migrated ||= key !== canonical;
    const target = (mapped[canonical] ??= {
      included: new Set(),
      excluded: new Set(),
    });
    values.included.forEach(value => target.included.add(value));
    values.excluded.forEach(value => target.excluded.add(value));
    if (values.range) target.range = values.range;
  }
  return migrated ? [...remaining, ...filtersToQuery(mapped)] : filters;
}

export function useNetflowFilterState({
  source,
  filters,
  onChange,
}: {
  source?: TNetflowSource;
  filters: Filter[];
  onChange: (filters: Filter[]) => void;
}) {
  // Keys are SQL expressions, not physical columns; restore their quoting at emission.
  const knownColumns = useMemo(() => new Set<string>(), []);
  const dimensions = useMemo(
    () => (source ? getNetflowDimensions(source) : undefined),
    [source],
  );
  const expressions = useMemo(() => {
    const result = new Map(
      Object.keys(parseQuery(filters).filters).map(expression => [
        cleanClickHouseExpression(expression),
        expression,
      ]),
    );
    for (const [field, expression] of Object.entries(dimensions ?? {})) {
      if (!expression) continue;
      const canonical = sankeyDimensionExpression({
        key: field,
        label: field,
        expression,
      });
      result.set(cleanClickHouseExpression(expression), canonical);
      result.set(cleanClickHouseExpression(canonical), canonical);
    }
    return result;
  }, [dimensions, filters]);
  const normalizedFilters = useMemo(
    () => canonicalizeMappedFilters(filters, expressions),
    [filters, expressions],
  );
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    if (normalizedFilters !== filters) onChangeRef.current(normalizedFilters);
  }, [normalizedFilters, filters]);
  const clickedExpressionsRef = useRef(new Map<string, string>());
  const emitFilters = (next: FilterState) =>
    onChange(
      filtersToQuery(
        Object.fromEntries(
          Object.entries(next).map(([key, selection]) => [
            expressions.get(key) ??
              clickedExpressionsRef.current.get(key) ??
              key,
            selection,
          ]),
        ),
      ),
    );
  const state = useSearchPageFilterState({
    searchQuery: normalizedFilters,
    onFilterChange: next => emitFilters(parseQuery(next).filters),
    knownColumns,
  });
  const applyFilter = (
    expression: string,
    value: string,
    excluded: boolean,
  ) => {
    const field = cleanClickHouseExpression(expression);
    clickedExpressionsRef.current.set(field, expression);
    state.setFilters(previous => {
      const old = previous[field];
      const polarity = excluded ? 'excluded' : 'included';
      const opposite = excluded ? 'included' : 'excluded';
      if (old?.[polarity].has(value) && !old[opposite].has(value))
        return previous;
      const values = {
        ...old,
        included: new Set(old?.included),
        excluded: new Set(old?.excluded),
      };
      values[polarity].add(value);
      values[opposite].delete(value);
      const next = { ...previous, [field]: values };
      emitFilters(next);
      return next;
    });
  };
  const onFilter: NetflowFilterHandler = (field, value, excluded) => {
    const expression = dimensions?.[field];
    const canonical =
      expression && expressions.get(cleanClickHouseExpression(expression));
    if (canonical) applyFilter(canonical, value, excluded);
  };
  const onDimensionFilter: SankeyFilterHandler = (
    dimension,
    value,
    excluded,
  ) => {
    applyFilter(
      expressions.get(cleanClickHouseExpression(dimension.expression)) ??
        sankeyDimensionExpression(dimension),
      value,
      excluded,
    );
  };
  const fieldLabels = Object.fromEntries(
    Object.entries(dimensions ?? {}).flatMap(([field, expression]) =>
      expression
        ? [
            [
              cleanClickHouseExpression(expression),
              NETFLOW_DIMENSION_LABELS[field],
            ],
            [
              cleanClickHouseExpression(
                sankeyDimensionExpression({
                  key: field,
                  label: field,
                  expression,
                }),
              ),
              NETFLOW_DIMENSION_LABELS[field],
            ],
          ]
        : [],
    ),
  );
  return { state, onFilter, onDimensionFilter, fieldLabels };
}

export default function NetflowFilterPills({
  state,
  fieldLabels,
  chartConfig,
}: Pick<ReturnType<typeof useNetflowFilterState>, 'state' | 'fieldLabels'> & {
  chartConfig: BuilderChartConfigWithDateRange;
}) {
  return (
    <ActiveFilterPills
      searchFilters={state}
      chartConfig={chartConfig}
      enableValueEditing={false}
      fieldLabel={field =>
        fieldLabels[field] ?? unwrapSankeyDimensionExpression(field)
      }
      px={0}
      gap="xs"
      data-testid="netflow-filter-pills"
    />
  );
}
