import { Select } from '@mantine/core';

export default function DSSelect<
  Option extends { label: string; value: string },
>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: Option[];
  disabled?: boolean;
  value: string | undefined;
  onChange: (value: Option['value'] | undefined) => void;
}) {
  return (
    <Select
      disabled={disabled}
      data={options}
      className="ds-select"
      value={value}
      onChange={newValue => onChange(newValue ?? undefined)}
    />
  );
}
