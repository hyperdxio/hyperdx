import { Group, Select } from '@mantine/core';

import { useGetKeyValues } from './hooks/useMetadata';
import { useSource } from './source';

export type DashboardParameter = {
  type: 'query';
  id: string;
  name: string;
  key: string;
  sourceId: string;
};

const DashboardParameterSelect = ({
  parameter,
  dateRange,
  onChange,
}: {
  parameter: DashboardParameter;
  dateRange: [Date, Date];
  onChange: (value: any) => void;
}) => {
  const {
    data: { timestampValueExpression, connection, from } = {},
    isLoading: isSourceLoading,
  } = useSource({
    id: parameter.sourceId,
  });

  const { data: keys, isLoading: isKeyValuesLoading } = useGetKeyValues(
    {
      chartConfigs: {
        dateRange,
        timestampValueExpression: timestampValueExpression!,
        connection: connection!,
        from: from!,
        where: '',
        whereLanguage: 'sql',
        select: '',
      },
      keys: [parameter.key],
    },
    {
      enabled: !!timestampValueExpression && !!connection && !!from,
    },
  );

  return (
    <Select
      placeholder={parameter.name}
      data={keys?.[0]?.value.map(value => ({ value, label: value })) || []}
      searchable
      clearable
      allowDeselect
      size="xs"
      maxDropdownHeight={280}
      disabled={isSourceLoading || isKeyValuesLoading}
      variant="filled"
      w={200}
      limit={20}
      onChange={onChange}
    />
  );
};

interface DashboardParametersProps {
  parameters: Record<string, DashboardParameter>;
  parameterValues: Record<string, any>;
  onSetParameterValue: (key: string, value: any) => void;
  dateRange: [Date, Date];
}

const DashboardParameters = ({
  parameters,
  dateRange,
  onSetParameterValue,
}: DashboardParametersProps) => {
  return (
    <Group mt="sm">
      {Object.values(parameters).map(parameter => (
        <DashboardParameterSelect
          key={parameter.id}
          parameter={parameter}
          dateRange={dateRange}
          onChange={value => onSetParameterValue(parameter.id, value)}
        />
      ))}
    </Group>
  );
};

export default DashboardParameters;
