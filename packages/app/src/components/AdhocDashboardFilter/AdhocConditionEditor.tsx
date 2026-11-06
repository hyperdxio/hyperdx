import { useState } from 'react';
import { ResolvedFilterValuesQuery } from '@hyperdx/common-utils/dist/filters';
import {
  AdhocDashboardFilter,
  AdhocFilterCondition,
} from '@hyperdx/common-utils/dist/types';

import {
  FilterConditionEditor,
  FilterOperator,
  getFilterOperators,
} from '@/components/FilterPill';

import { useAdhocFilterOptions } from './useAdhocFilterOptions';

type AdhocConditionEditorProps = {
  filter: AdhocDashboardFilter;
  dateRange: [Date, Date];
  /** The filter's `where`, variables expanded, narrowing the suggestions. */
  suggestionsWhere?: ResolvedFilterValuesQuery;
  /** The condition being edited; unset when adding one. */
  initial?: AdhocFilterCondition;
  onSubmit: (condition: AdhocFilterCondition) => void;
};

/**
 * Pick a condition from the filter's keys and values. Mounted only while its
 * popover is open, so keys load on open and values once a key is picked.
 */
export function AdhocConditionEditor({
  filter,
  dateRange,
  suggestionsWhere,
  initial,
  onSubmit,
}: AdhocConditionEditorProps) {
  const [valueKey, setValueKey] = useState(initial?.key ?? '');
  const { keys, values } = useAdhocFilterOptions(
    filter,
    valueKey,
    dateRange,
    suggestionsWhere,
  );
  const isPromql = filter.sourceType === 'promql';

  return (
    <FilterConditionEditor<FilterOperator>
      operators={getFilterOperators(filter.sourceType)}
      initial={initial}
      keyOptions={keys.data}
      isLoadingKeys={keys.isLoading}
      isKeysError={keys.isError}
      keysErrorMessage={keys.error?.message}
      valueOptions={values.data}
      isLoadingValues={values.isLoading}
      isValuesError={values.isError}
      valuesErrorMessage={values.error?.message}
      onKeyChange={setValueKey}
      keyLabel={isPromql ? 'Label' : 'Key'}
      keyPlaceholder={
        isPromql ? 'Select a label' : 'Select a column or map key'
      }
      onSubmit={onSubmit}
      data-testid={`adhoc-condition-editor-${filter.name}`}
    />
  );
}
