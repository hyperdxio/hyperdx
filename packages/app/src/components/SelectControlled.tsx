import { useCallback } from 'react';
import { useController, UseControllerProps } from 'react-hook-form';
import { Select, SelectProps } from '@mantine/core';

export type SelectControlledProps = SelectProps &
  UseControllerProps<any> & {
    onCreate?: () => void;
    allowDeselect?: boolean;
  };

export default function SelectControlled(props: SelectControlledProps) {
  const { field, fieldState } = useController(props);
  const { onCreate, allowDeselect = true, ...restProps } = props;

  // This is needed as mantine does not clear the select
  // if the value is not in the data after
  // if it was previously in the data (ex. data was deleted)
  const selected = props.data?.find(d =>
    typeof d === 'string'
      ? d === field.value
      : 'value' in d
        ? d.value === field.value
        : true,
  );

  const onChange = useCallback(
    (value: string | null) => {
      if (value === '_create_new_value' && onCreate != null) {
        onCreate();
      } else if (value !== null || allowDeselect) {
        field.onChange(value);
      }
    },
    [field, onCreate, allowDeselect],
  );

  return (
    <Select
      {...restProps}
      error={fieldState.error?.message}
      value={selected == null ? null : field.value}
      onChange={onChange}
      onBlur={field.onBlur}
      name={field.name}
      ref={field.ref}
    />
  );
}
