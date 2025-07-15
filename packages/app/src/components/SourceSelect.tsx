import { memo, useMemo } from 'react';
import { UseControllerProps } from 'react-hook-form';
import { SourceKind } from '@hyperdx/common-utils/dist/types';

import SelectControlled from '@/components/SelectControlled';
import { HDX_LOCAL_DEFAULT_SOURCES } from '@/config';
import { useSources } from '@/source';

function SourceSelectControlledComponent({
  size,
  onCreate,
  allowedSourceKinds,
  ...props
}: {
  size?: string;
  onCreate?: () => void;
  allowedSourceKinds?: SourceKind[];
} & UseControllerProps<any>) {
  const { data } = useSources();
  const hasLocalDefaultSources = !!HDX_LOCAL_DEFAULT_SOURCES;

  const values = useMemo(
    () => [
      ...(data
        ?.filter(
          source =>
            !allowedSourceKinds || allowedSourceKinds.includes(source.kind),
        )
        .map(d => ({
          value: d.id,
          label: d.name,
        })) ?? []),
      ...(onCreate && !hasLocalDefaultSources
        ? [
            {
              value: '_create_new_value',
              label: 'Create New Source',
            },
          ]
        : []),
    ],
    [data, onCreate, allowedSourceKinds, hasLocalDefaultSources],
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

export const SourceSelectControlled = memo(SourceSelectControlledComponent);
