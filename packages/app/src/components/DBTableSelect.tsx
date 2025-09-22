import { useController, UseControllerProps } from 'react-hook-form';
import { Flex, Select } from '@mantine/core';

import { useTablesDirect } from '@/clickhouse';

import SourceSchemaPreview from './SourceSchemaPreview';

export default function DBTableSelect({
  database,
  setTable,
  table,
  onBlur,
  name,
  size,
  inputRef,
  connectionId,
}: {
  database: string | undefined;
  connectionId: string | undefined;
  setTable: (table: string | undefined) => void;
  table: string | undefined;
  onBlur?: () => void;
  inputRef?: React.Ref<HTMLInputElement>;
  name?: string;
  size?: string;
}) {
  const { data: tables, isLoading: isTablesLoading } = useTablesDirect(
    { database: database ?? '', connectionId: connectionId ?? '' },
    {
      enabled: !!database && !!connectionId,
    },
  );

  const data = (tables?.data || []).map((db: { name: string }) => ({
    value: db.name,
    label: db.name,
  }));

  return (
    <Flex align="center" gap={8}>
      <Select
        searchable
        placeholder="Table"
        leftSection={<i className="bi bi-table"></i>}
        maxDropdownHeight={280}
        data={data}
        disabled={isTablesLoading}
        value={table}
        comboboxProps={{ withinPortal: false }}
        onChange={v => setTable(v ?? undefined)}
        onBlur={onBlur}
        name={name}
        ref={inputRef}
        size={size}
        className="flex-grow-1"
      />
      <SourceSchemaPreview
        source={
          connectionId && database && table
            ? {
                connection: connectionId,
                from: { databaseName: database, tableName: table },
              }
            : undefined
        }
        iconStyles={{ color: 'gray.4' }}
      />
    </Flex>
  );
}

export function DBTableSelectControlled({
  database,
  connectionId,
  ...props
}: {
  database?: string;
  size?: string;
  connectionId: string | undefined;
} & UseControllerProps<any>) {
  const {
    field,
    fieldState: { invalid, isTouched, isDirty },
    formState: { touchedFields, dirtyFields },
  } = useController(props);

  return (
    <DBTableSelect
      {...props}
      database={database}
      connectionId={connectionId}
      table={field.value}
      setTable={field.onChange}
      onBlur={field.onBlur} // notify when input is touched/blur
      name={field.name} // send down the input name
      inputRef={field.ref} // send input ref, so we can focus on input when error appear
    />
  );
}
