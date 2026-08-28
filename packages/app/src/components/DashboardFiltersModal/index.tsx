import { useEffect, useState } from 'react';
import { isQueryExpressionFilter } from '@hyperdx/common-utils/dist/filters';
import {
  ChartVariable,
  DashboardFilter,
  TSource,
} from '@hyperdx/common-utils/dist/types';

import { getStoredLanguage } from '@/components/SearchInput/SearchWhereInput';
import { SqlVariablesProvider } from '@/components/SQLEditor/variableCompletions';

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

const NEW_FILTER_ID = 'new';

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
  const [selectedFilter, setSelectedFilter] = useState<DashboardFilter>();

  useEffect(() => {
    if (opened) {
      setSelectedFilter(undefined);
    }
  }, [opened]);

  const handleRemoveFilter = (id: string) => {
    if (id === selectedFilter?.id) {
      setSelectedFilter(filters.find(f => f.id !== id));
    }
    onRemoveFilter(id);
  };

  const handleAddNewFilter = () => {
    setSelectedFilter({
      id: NEW_FILTER_ID,
      type: 'QUERY_EXPRESSION',
      name: '',
      expression: '',
      source: source?.id ?? '',
      where: '',
      whereLanguage: getStoredLanguage() ?? 'sql',
      isBroadcastEnabled: true,
      isVariableEnabled: false,
    });
  };

  const handleSaveFilter = (filter: DashboardFilter) => {
    setSelectedFilter(undefined);
    if (filter.id === NEW_FILTER_ID) {
      const filterWithRealId = { ...filter, id: crypto.randomUUID() };
      onSaveFilter(filterWithRealId);
    } else {
      onSaveFilter(filter);
    }
  };

  const isEmpty = !selectedFilter && filters.length === 0;

  if (!opened) {
    return null;
  } else if (isEmpty) {
    return (
      <DashboardFiltersEmptyState
        onCreateFilter={handleAddNewFilter}
        onClose={onClose}
      />
    );
  } else if (selectedFilter && isQueryExpressionFilter(selectedFilter)) {
    return (
      <SqlVariablesProvider variables={variables}>
        <DashboardFilterEditForm
          filter={selectedFilter}
          onSave={handleSaveFilter}
          onCancel={() => setSelectedFilter(undefined)}
          onClose={onClose}
          isNew={selectedFilter.id === NEW_FILTER_ID}
          source={source}
          filters={filters}
          showVariableOptions={showVariableOptions}
        />
      </SqlVariablesProvider>
    );
  } else {
    return (
      <DashboardFiltersList
        filters={filters}
        onEdit={setSelectedFilter}
        onRemove={handleRemoveFilter}
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
