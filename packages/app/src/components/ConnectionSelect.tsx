import { useMemo } from 'react';
import { UseControllerProps } from 'react-hook-form';

import SelectControlled from '@/components/SelectControlled';
import { useConnections } from '@/connection';

export function ConnectionSelectControlled({
  size,
  ...props
}: { size?: string } & UseControllerProps<any>) {
  const { data } = useConnections();

  const values = useMemo(
    () =>
      data?.map(d => ({
        value: d.id,
        label: d.name,
      })),
    [data],
  );

  return (
    <SelectControlled
      {...props}
      allowDeselect={false}
      data={values}
      // disabled={isDatabasesLoading}
      comboboxProps={{ withinPortal: false }}
      searchable
      placeholder="Connection"
      leftSection={<i className="bi bi-hdd-stack"></i>}
      maxDropdownHeight={280}
      size={size}
    />
  );
}
