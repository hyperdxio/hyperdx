import { useController, UseControllerProps } from 'react-hook-form';
import { Select } from '@mantine/core';

import { useDatabasesDirect } from '@/clickhouse';

type DatabaseSelectProps = {
  database: string | undefined;
  setDatabase: (db: string | undefined) => void;
  onBlur?: () => void;
  inputRef?: React.Ref<HTMLInputElement>;
  name?: string;
  size?: string;
  connectionId: string | undefined;
};

export default function DatabaseSelect({
  database,
  setDatabase,
  connectionId,
  onBlur,
  name,
  inputRef,
  size,
}: DatabaseSelectProps) {
  const { data: databases, isLoading: isDatabasesLoading } = useDatabasesDirect(
    { connectionId: connectionId ?? '' },
    { enabled: !!connectionId },
  );

  const data = (databases?.data || []).map((db: { name: string }) => ({
    value: db.name,
    label: db.name,
  }));

  return (
    <Select
      searchable
      placeholder="Database"
      leftSection={<i className="bi bi-database"></i>}
      maxDropdownHeight={280}
      data={data}
      disabled={isDatabasesLoading}
      comboboxProps={{ withinPortal: false }}
      value={database}
      onChange={v => setDatabase(v ?? undefined)}
      onBlur={onBlur}
      name={name}
      ref={inputRef}
      size={size}
    />
  );
}

export function DatabaseSelectControlled(
  props: { size?: string; connectionId: string } & UseControllerProps<any>,
) {
  const { field } = useController(props);

  return (
    <DatabaseSelect
      {...props}
      database={field.value}
      setDatabase={field.onChange}
      onBlur={field.onBlur} // notify when input is touched/blur
      name={field.name} // send down the input name
      inputRef={field.ref} // send input ref, so we can focus on input when error appear
    />
  );
}
