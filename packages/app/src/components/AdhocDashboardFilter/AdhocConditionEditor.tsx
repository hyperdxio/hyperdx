import { useState } from 'react';
import {
  AdhocDashboardFilter,
  AdhocFilterCondition,
} from '@hyperdx/common-utils/dist/types';

import {
  FilterConditionEditor,
  FilterOperator,
  getFilterOperators,
} from '@/components/FilterPill';

import {
  useAdhocFilterKeys,
  useAdhocFilterValues,
} from './useAdhocFilterOptions';

type AdhocConditionEditorProps = {
  filter: AdhocDashboardFilter;
  dateRange: [Date, Date];
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
  initial,
  onSubmit,
}: AdhocConditionEditorProps) {
  const [valueKey, setValueKey] = useState(initial?.key ?? '');
  const keys = useAdhocFilterKeys(filter, dateRange);
  const values = useAdhocFilterValues(
    filter,
    valueKey,
    dateRange,
    keys.keysBySourceId,
  );
  const isPromql = filter.sourceType === 'promql';

  return (
    <FilterConditionEditor<FilterOperator>
      operators={getFilterOperators(filter.sourceType)}
      initial={initial}
      keyOptions={keys.data}
      isLoadingKeys={keys.isLoading}
      isKeysError={keys.isError}
      valueOptions={values.data}
      isLoadingValues={values.isLoading}
      isValuesError={values.isError}
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
