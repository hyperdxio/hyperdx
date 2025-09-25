import { useCallback, useState } from 'react';
import { DashboardFilter, Filter } from '@hyperdx/common-utils/dist/types';

const convertDashboardFiltersToSql = (
  filters: DashboardFilter[],
  values: Record<string, any>,
): Filter[] => {
  return Object.entries(values)
    .map(([id, value]) => {
      const filter = filters.find(p => p.id === id);
      if (!filter) return null;

      return {
        type: 'sql' as const,
        condition: `${filter.expression} = '${value}'`,
      };
    })
    .filter(f => f !== null);
};

const useDashboardFilters = (filters: DashboardFilter[]) => {
  const [filterValues, setFilterValues] = useState<Record<string, any>>({});

  const setFilterValue = useCallback((key: string, value: any) => {
    if (value === undefined || value === null) {
      setFilterValues(prev => {
        const newValues = { ...prev };
        delete newValues[key];
        return newValues;
      });
    } else {
      setFilterValues(prev => ({ ...prev, [key]: value }));
    }
  }, []);

  const filtersAsSql = convertDashboardFiltersToSql(filters, filterValues);

  return {
    filterValues,
    setFilterValue,
    filtersAsSql,
  };
};

export default useDashboardFilters;
