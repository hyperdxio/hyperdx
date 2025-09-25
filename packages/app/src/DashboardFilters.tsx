import { DashboardFilter } from '@hyperdx/common-utils/dist/types';
import { Group, Select } from '@mantine/core';

import { useGetKeyValues } from './hooks/useMetadata';
import { useSource } from './source';
import { getMetricTableName } from './utils';

interface DashboardFilterSelectProps {
  filter: DashboardFilter;
  dateRange: [Date, Date];
  onChange: (value: any) => void;
}

const DashboardFilterSelect = ({
  filter,
  dateRange,
  onChange,
}: DashboardFilterSelectProps) => {
  const { data: source, isLoading: isSourceLoading } = useSource({
    id: filter.source,
  });

  const { timestampValueExpression, connection } = source || {};

  const databaseName = source?.from.databaseName;
  const tableName =
    source && getMetricTableName(source, filter.sourceMetricType);

  const { data: keys, isLoading: isKeyValuesLoading } = useGetKeyValues(
    {
      chartConfigs: {
        dateRange,
        timestampValueExpression: timestampValueExpression!,
        connection: connection!,
        from: {
          databaseName: databaseName!,
          tableName: tableName!,
        }!,
        where: '',
        whereLanguage: 'sql',
        select: '',
      },
      keys: [filter.expression],
    },
    {
      enabled:
        !!timestampValueExpression &&
        !!connection &&
        !!tableName &&
        !!databaseName,
    },
  );

  return (
    <Select
      placeholder={filter.name}
      data={
        keys?.[0]?.value.map(value => ({
          value: String(value),
          label: String(value),
        })) || []
      }
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

interface DashboardFilterProps {
  filters: DashboardFilter[];
  filterValues: Record<string, any>;
  onSetFilterValue: (key: string, value: any) => void;
  dateRange: [Date, Date];
}

const DashboardFilters = ({
  filters,
  dateRange,
  onSetFilterValue,
}: DashboardFilterProps) => {
  return (
    <Group mt="sm">
      {Object.values(filters).map(filter => (
        <DashboardFilterSelect
          key={filter.id}
          filter={filter}
          dateRange={dateRange}
          onChange={value => onSetFilterValue(filter.id, value)}
        />
      ))}
    </Group>
  );
};

export default DashboardFilters;
