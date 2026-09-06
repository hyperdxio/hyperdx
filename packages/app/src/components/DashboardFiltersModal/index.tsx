import { useCallback, useEffect, useState } from 'react';
import {
  ChartVariable,
  DashboardFilter,
  TSource,
} from '@hyperdx/common-utils/dist/types';

import { DashboardFilterEditForm } from './DashboardFilterEditForm';
import { DashboardFiltersEmptyState } from './DashboardFiltersEmptyState';
import { DashboardFiltersList } from './DashboardFiltersList';

interface DashboardFiltersEditModalProps {
  opened: boolean;
  filters: DashboardFilter[];
  isLoading?: boolean;
  source?: TSource;
  /** Whether to offer the broadcast / variable controls. */
  showVariableOptions: boolean;
  /** The dashboard's variables, if any */
  variables?: ChartVariable[];
  onClose: () => void;
  onSaveFilter: (filter: DashboardFilter) => void;
  onRemoveFilter: (id: string) => void;
}

const DashboardFiltersModal = ({
  opened,
  filters,
  isLoading,
  source,
  showVariableOptions,
  variables,
  onClose,
  onSaveFilter,
  onRemoveFilter,
}: DashboardFiltersEditModalProps) => {
  // Undefined when not editing, set to the filter being edited when editing.
  // The filter is undefined when creating a new one.
  const [editState, setEditState] = useState<{ filter?: DashboardFilter }>();

  const startEditing = useCallback(
    (filter?: DashboardFilter) => setEditState({ filter }),
    [],
  );
  const stopEditing = useCallback(() => setEditState(undefined), []);

  useEffect(() => {
    if (opened) {
      setEditState(undefined);
    }
  }, [opened]);

  const handleAddNewFilter = useCallback(() => setEditState({}), []);

  const handleSaveFilter = useCallback(
    (filter: DashboardFilter) => {
      setEditState(undefined);
      onSaveFilter(filter);
    },
    [onSaveFilter],
  );

  if (!opened) {
    return null;
  } else if (editState) {
    return (
      <DashboardFilterEditForm
        filter={editState.filter}
        filters={filters}
        source={source}
        showVariableOptions={showVariableOptions}
        variables={variables}
        onSave={handleSaveFilter}
        onCancel={stopEditing}
        onClose={onClose}
      />
    );
  } else if (filters.length === 0) {
    return (
      <DashboardFiltersEmptyState
        onCreateFilter={handleAddNewFilter}
        onClose={onClose}
      />
    );
  } else {
    return (
      <DashboardFiltersList
        filters={filters}
        onEdit={startEditing}
        onRemove={onRemoveFilter}
        onClose={onClose}
        onAddNew={handleAddNewFilter}
        isLoading={isLoading}
        hideAppliesTo={!!source}
        showVariableOptions={showVariableOptions}
      />
    );
  }
};

export default DashboardFiltersModal;
