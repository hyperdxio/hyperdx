import { memo, useCallback } from 'react';
import { useController, UseControllerProps } from 'react-hook-form';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import {
  ComboboxItem,
  Group,
  MultiSelect,
  MultiSelectProps,
} from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';

import {
  SOURCE_KIND_ICONS,
  useFilteredSortedSourceItems,
  useSourceKindMap,
} from '@/components/sourceSelectUtils';
import { useSources } from '@/source';

function SourceMultiSelectControlledComponent({
  allowedSourceKinds,
  connectionId,
  size,
  placeholder,
  ...props
}: {
  allowedSourceKinds?: SourceKind[];
  connectionId?: string;
  size?: string;
  placeholder?: string;
} & UseControllerProps<any> &
  Omit<MultiSelectProps, 'data' | 'value' | 'onChange' | 'name'>) {
  const { data } = useSources();
  const {
    field: { value, onChange, onBlur, name, ref },
    fieldState,
  } = useController(props);

  const sourceKindMap = useSourceKindMap(data);

  const items = useFilteredSortedSourceItems({
    sources: data,
    allowedSourceKinds,
    connectionId,
  });

  // Mantine passes `checked` to renderOption for MultiSelect items; show a
  // check on selected entries so the dropdown reflects current selection
  // without forcing the user to scan pills above.
  const renderOption = useCallback(
    ({ option, checked }: { option: ComboboxItem; checked?: boolean }) => {
      const icon = SOURCE_KIND_ICONS[sourceKindMap.get(option.value) ?? ''];
      return (
        <Group gap="xs" wrap="nowrap" w="100%">
          {icon}
          <span style={{ flex: 1 }}>{option.label}</span>
          {checked && (
            <IconCheck size={14} color="var(--color-text-brand)" stroke={2.5} />
          )}
        </Group>
      );
    },
    [sourceKindMap],
  );

  return (
    <MultiSelect
      {...props}
      data={items}
      value={Array.isArray(value) ? value : []}
      onChange={onChange}
      onBlur={onBlur}
      name={name}
      ref={ref}
      error={fieldState.error?.message}
      searchable
      clearable
      placeholder={placeholder ?? 'All sources'}
      maxDropdownHeight={280}
      size={size}
      renderOption={renderOption}
      comboboxProps={{ withinPortal: false, ...props.comboboxProps }}
    />
  );
}

export const SourceMultiSelectControlled = memo(
  SourceMultiSelectControlledComponent,
);
