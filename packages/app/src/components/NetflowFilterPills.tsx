import { Filter, TNetflowSource } from '@hyperdx/common-utils/dist/types';
import { Group } from '@mantine/core';

import { getNetflowDimensions } from '@/netflow';
import {
  sankeyDimensionExpression,
  SankeyFilterHandler,
} from '@/netflowSankey';
import { useSearchPageFilterState } from '@/searchFilters';

import { cleanClickHouseExpression } from './DBSearchPageFilters/utils';
import { FilterPill } from './FilterPill';
import { NetflowFilterHandler } from './NetflowFilterMenu';

const labels = new Map([
  ['srcAddr', 'Source IP'],
  ['dstAddr', 'Destination IP'],
  ['protocol', 'Protocol'],
  ['exporter', 'Exporter'],
  ['inputInterface', 'Input interface'],
  ['outputInterface', 'Output interface'],
]);
const knownColumns = new Set<string>();

export function useNetflowFilterState({
  source,
  filters,
  onChange,
}: {
  source?: TNetflowSource;
  filters: Filter[];
  onChange: (filters: Filter[]) => void;
}) {
  const state = useSearchPageFilterState({
    searchQuery: filters,
    onFilterChange: onChange,
    knownColumns,
  });
  const dimensions = source ? getNetflowDimensions(source) : undefined;
  const onFilter: NetflowFilterHandler = (field, value, excluded) => {
    const expression = dimensions?.[field];
    if (expression)
      state.setFilterValue(expression, value, excluded ? 'exclude' : 'include');
  };
  const onDimensionFilter: SankeyFilterHandler = (
    dimension,
    value,
    excluded,
  ) => {
    state.setFilterValue(
      sankeyDimensionExpression(dimension),
      value,
      excluded ? 'exclude' : 'include',
    );
  };
  const fieldLabels = Object.fromEntries(
    Object.entries(dimensions ?? {}).flatMap(([field, expression]) =>
      expression
        ? [
            [cleanClickHouseExpression(expression), labels.get(field) ?? field],
            [
              cleanClickHouseExpression(
                sankeyDimensionExpression({
                  key: field,
                  label: field,
                  expression,
                }),
              ),
              labels.get(field) ?? field,
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
}: Pick<ReturnType<typeof useNetflowFilterState>, 'state' | 'fieldLabels'>) {
  return (
    <Group gap="xs" data-testid="netflow-filter-pills">
      {Object.entries(state.filters).flatMap(([field, values]) =>
        (['included', 'excluded'] as const).flatMap(polarity =>
          Array.from(values[polarity]).map(value => (
            <FilterPill
              key={`${field}:${polarity}:${value}`}
              field={
                fieldLabels[field] ??
                field.replace(/^ifNull\(toString\((.*)\), ''\)$/s, '$1')
              }
              value={String(value)}
              operator={polarity === 'excluded' ? '!=' : '='}
              isExcluded={polarity === 'excluded'}
              onRemove={() =>
                state.setFilterValue(
                  field,
                  value,
                  polarity === 'excluded' ? 'exclude' : 'include',
                )
              }
            />
          )),
        ),
      )}
    </Group>
  );
}
