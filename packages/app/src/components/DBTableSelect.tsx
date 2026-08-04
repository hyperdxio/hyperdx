import { useState } from 'react';
import { useController, UseControllerProps } from 'react-hook-form';
import { ComboboxChevron, Flex, Select } from '@mantine/core';
import { IconTable } from '@tabler/icons-react';

import { useTablesDirect } from '@/clickhouse';

import SourceSchemaPreview, {
  isSourceSchemaPreviewEnabled,
} from './SourceSchemaPreview';
import { SourceManagementMenu } from './SourceSelect';

function DBTableSelect({
  database,
  setTable,
  table,
  onBlur,
  name,
  size,
  inputRef,
  connectionId,
  testId,
}: {
  database: string | undefined;
  connectionId: string | undefined;
  setTable: (table: string | undefined) => void;
  table: string | undefined;
  onBlur?: () => void;
  inputRef?: React.Ref<HTMLInputElement>;
  name?: string;
  size?: string;
  testId?: string;
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

  const [isSchemaPreviewOpen, setIsSchemaPreviewOpen] = useState(false);
  const previewSource =
    connectionId && database && table
      ? {
          connection: connectionId,
          from: { databaseName: database, tableName: table },
        }
      : undefined;

  return (
    <Flex align="center" gap={4}>
      <Select
        searchable
        placeholder="Table"
        leftSection={<IconTable size={16} />}
        rightSection={<ComboboxChevron />}
        maxDropdownHeight={280}
        data={data}
        disabled={isTablesLoading}
        value={table}
        comboboxProps={{ withinPortal: true }}
        onChange={v => setTable(v ?? undefined)}
        onBlur={onBlur}
        name={name}
        ref={inputRef}
        size={size}
        className="flex-grow-1"
        data-testid={testId}
      />
      <SourceManagementMenu
        hasSelection={!!table}
        onSchemaPreview={() => setIsSchemaPreviewOpen(true)}
        isSchemaPreviewEnabled={isSourceSchemaPreviewEnabled(previewSource)}
      />
      <SourceSchemaPreview
        source={previewSource}
        controlled
        open={isSchemaPreviewOpen}
        onClose={() => setIsSchemaPreviewOpen(false)}
      />
    </Flex>
  );
}

export function DBTableSelectControlled({
  database,
  connectionId,
  testId,
  ...props
}: {
  database?: string;
  size?: string;
  connectionId: string | undefined;
  testId?: string;
} & UseControllerProps<any>) {
  const { field } = useController(props);

  return (
    <DBTableSelect
      {...props}
      database={database}
      connectionId={connectionId}
      testId={testId}
      table={field.value}
      setTable={field.onChange}
      onBlur={field.onBlur} // notify when input is touched/blur
      name={field.name} // send down the input name
      inputRef={field.ref} // send input ref, so we can focus on input when error appear
    />
  );
}
