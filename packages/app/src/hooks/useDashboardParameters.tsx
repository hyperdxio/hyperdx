import { useCallback, useState } from 'react';
import { DashboardParameter, Filter } from '@hyperdx/common-utils/dist/types';

const dashboardParametersToFilters = (
  parameters: DashboardParameter[],
  values: Record<string, any>,
): Filter[] => {
  return Object.entries(values)
    .map(([id, value]) => {
      const parameterDefinition = parameters.find(p => p.id === id);
      if (!parameterDefinition) return null;

      return {
        type: 'sql' as const,
        condition: `${parameterDefinition.expression} = '${value}'`,
      };
    })
    .filter(f => f !== null);
};

const useDashboardParameters = (parameters: DashboardParameter[]) => {
  const [parameterValues, setParameterValues] = useState<Record<string, any>>(
    {},
  );

  const setParameterValue = useCallback((key: string, value: any) => {
    if (value === undefined || value === null) {
      setParameterValues(prev => {
        const newValues = { ...prev };
        delete newValues[key];
        return newValues;
      });
    } else {
      setParameterValues(prev => ({ ...prev, [key]: value }));
    }
  }, []);

  const filters = dashboardParametersToFilters(parameters, parameterValues);

  return {
    parameterValues,
    setParameterValue,
    filters,
  };
};

export default useDashboardParameters;
