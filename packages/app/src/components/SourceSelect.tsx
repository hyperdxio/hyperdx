import { useMemo } from 'react';
import { UseControllerProps } from 'react-hook-form';

import SelectControlled from '@/components/SelectControlled';
import { useSources } from '@/source';

export function SourceSelectControlled({
  size,
  onCreate,
  ...props
}: { size?: string; onCreate?: () => void } & UseControllerProps<any>) {
  const { data } = useSources();

  const values = useMemo(
    () => [
      ...(data?.map(d => ({
        value: d.id,
        label: d.name,
      })) ?? []),
      ...(onCreate
        ? [
            {
              value: '_create_new_value',
              label: 'Create New Source',
            },
          ]
        : []),
    ],
    [data, onCreate],
  );

  return (
    <SelectControlled
      {...props}
      data={values}
      // disabled={isDatabasesLoading}
      comboboxProps={{ withinPortal: false }}
      searchable
      placeholder="Data Source"
      leftSection={<i className="bi bi-collection"></i>}
      maxDropdownHeight={280}
      size={size}
      onCreate={onCreate}
    />
  );
}
