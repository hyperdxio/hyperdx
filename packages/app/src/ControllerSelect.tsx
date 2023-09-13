import { Controller } from 'react-hook-form';
import Select from 'react-select';

import type { Control } from 'react-hook-form';

export default function ControllerSelect<
  Option extends { value: string | undefined; label: React.ReactNode },
>({
  control,
  defaultValue,
  name,
  options,
}: {
  options: Option[];
  defaultValue: string | undefined;
  name: string;
  control: Control<any>;
}) {
  return (
    <Controller
      control={control}
      defaultValue={defaultValue}
      name={name}
      render={({ field: { onChange, value, ref } }) => (
        <Select
          ref={ref}
          className="ds-select"
          classNamePrefix="ds-react-select"
          options={options}
          value={options.find(c => c.value === value)}
          onChange={val => onChange(val?.value)}
        />
      )}
    />
  );
}
