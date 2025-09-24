import { useCallback, useState } from 'react';
import { DashboardParameter, Filter } from '@hyperdx/common-utils/dist/types';

const dashboardParametersToFilters = (
  parameters: Record<string, DashboardParameter>,
  values: Record<string, any>,
): Filter[] => {
  return Object.entries(values)
    .filter(([id]) => parameters[id])
    .map(([id, value]) => {
      const parameterDefinition = parameters[id];

      return {
        type: 'sql' as const,
        condition: `${parameterDefinition.expression} = '${value}'`,
      };
    });
};

export const useDashboardParameters = (
  initialParameters: Record<string, DashboardParameter>,
) => {
  const [parameterDefinitions, setParametersDefinitions] =
    useState<Record<string, DashboardParameter>>(initialParameters);

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

  const setParameterDefinition = useCallback(
    (parameter: DashboardParameter) => {
      setParametersDefinitions(prev => ({
        ...prev,
        [parameter.id]: parameter,
      }));
    },
    [],
  );

  const removeParameterDefinition = useCallback((id: string) => {
    setParametersDefinitions(prev => {
      const newParams = { ...prev };
      delete newParams[id];
      return newParams;
    });
    setParameterValues(prev => {
      const newValues = { ...prev };
      delete newValues[id];
      return newValues;
    });
  }, []);

  const filters = dashboardParametersToFilters(
    parameterDefinitions,
    parameterValues,
  );

  return {
    parameterValues,
    setParameterValue,
    parameterDefinitions,
    setParameterDefinition,
    removeParameterDefinition,
    filters,
  };
};
