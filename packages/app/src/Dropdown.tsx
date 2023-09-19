import { Form } from 'react-bootstrap';

export default function Dropdown<T extends string | number>({
  name,
  className,
  disabled,
  onChange,
  options,
  style,
  value,
}: {
  name?: string;
  className?: string;
  disabled?: boolean;
  onChange: (value: T) => any;
  options: Array<{ value: T; text: string }>;
  style?: { [key: string]: any };
  value: T | undefined;
}) {
  return (
    <Form.Select
      name={name}
      disabled={disabled}
      role="button"
      className={`shadow-none fw-bold ${
        (className ?? '').indexOf('bg-') >= 0 ? '' : 'bg-body'
      } w-auto ${className ?? ''}`}
      value={value}
      style={style}
      onChange={e => onChange(e.target.value as T)}
      title={options.find(opt => opt.value === value)?.text ?? ''}
    >
      {options.map(option => (
        <option value={option.value} key={option.value}>
          {option.text}
        </option>
      ))}
    </Form.Select>
  );
}
