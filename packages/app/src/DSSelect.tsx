import { Select } from '@mantine/core';

export default function DSSelect<
  Option extends { value: string | undefined; label: React.ReactNode },
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
      data={options.map(opt => ({
        value: opt.value ?? '',
        label: typeof opt.label === 'string' ? opt.label : String(opt.label),
      }))}
      value={value ?? null}
      onChange={newValue => onChange(newValue ?? undefined)}
      clearable
    />
  );
}
