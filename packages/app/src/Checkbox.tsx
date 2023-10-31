export default function Checkbox({
  id,
  className,
  labelClassName,
  checked,
  onChange,
  label,
  disabled,
  title,
}: {
  id: string;
  className?: string;
  labelClassName?: string;
  checked: boolean;
  onChange: () => void;
  label: React.ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <span className={`d-flex align-items-center ${className ?? ''}`}>
      <input
        className="me-2"
        type="checkbox"
        id={id}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      <label
        title={title}
        htmlFor={id}
        className={`fs-7 cursor-pointer ${labelClassName ?? ''}`}
      >
        <span className="text-muted-hover">{label}</span>
      </label>
    </span>
  );
}
