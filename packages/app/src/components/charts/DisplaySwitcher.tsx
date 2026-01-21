import cx from 'classnames';
import { ActionIcon, Group, Tooltip } from '@mantine/core';

interface DisplaySwitcherProps<T extends string> {
  value: T | undefined;
  onChange: (value: T) => void;
  options: {
    value: T;
    label: string;
    icon: React.ReactNode;
    disabled?: boolean;
  }[];
}

function DisplaySwitcher<T extends string>({
  value,
  onChange,
  options,
}: DisplaySwitcherProps<T>) {
  return (
    <Group
      className="bg-muted px-2 py-2 rounded fs-8"
      align="center"
      gap={0}
      wrap="nowrap"
    >
      {options.map(({ icon, label, value: optionValue, disabled }) => (
        <Tooltip label={label} key={optionValue}>
          <ActionIcon
            size="xs"
            me={2}
            className={cx({
              'text-brand': value === optionValue,
              'text-muted-hover': value !== optionValue,
            })}
            disabled={disabled}
            onClick={() => onChange(optionValue)}
          >
            {icon}
          </ActionIcon>
        </Tooltip>
      ))}
    </Group>
  );
}

export default DisplaySwitcher;
