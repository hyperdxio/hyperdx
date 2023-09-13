import Select from 'react-select';

export default function DSSelect<
  Option extends { value: string | undefined; label: React.ReactNode },
>({
  options,
  value,
  onChange,
}: {
  options: Option[];
  value: string | undefined;
  onChange: (value: Option['value'] | undefined) => void;
}) {
  return (
    <Select
      options={options}
      className="ds-select"
      value={options.find(v => v.value === value)}
      onChange={newValue => onChange(newValue?.value)}
      classNamePrefix="ds-react-select"
    />
  );
}
