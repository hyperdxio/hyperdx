import { KeyboardEventHandler, ReactElement, useState } from 'react';
import { Button, Menu } from '@mantine/core';

import { NETFLOW_DIMENSION_LABELS, NetflowFilterField } from '@/netflow';

export type NetflowFilterHandler = (
  field: NetflowFilterField,
  value: string,
  excluded: boolean,
) => void;

type TargetProps = {
  opened: boolean;
  buttonProps: {
    'aria-label': string;
    onKeyDown: KeyboardEventHandler;
    role?: 'button';
    tabIndex?: number;
  };
};
type Props = {
  value: string;
  allowEmpty?: boolean;
  target?: (props: TargetProps) => ReactElement;
} & (
  | { field: NetflowFilterField; onFilter?: NetflowFilterHandler }
  | { label: string; onSelect?: (excluded: boolean) => void }
);

export default function NetflowFilterMenu(props: Props) {
  const [opened, setOpened] = useState(false);
  const { value, allowEmpty = false, target } = props;
  const label =
    'field' in props ? NETFLOW_DIMENSION_LABELS[props.field] : props.label;
  const onSelect =
    'field' in props
      ? props.onFilter &&
        ((excluded: boolean) => props.onFilter?.(props.field, value, excluded))
      : props.onSelect;
  const interactive = !!onSelect && (allowEmpty || !!value.trim());
  const displayValue = value || (allowEmpty ? '(empty)' : '—');
  const buttonProps: TargetProps['buttonProps'] = {
    'aria-label': `Filter ${label}: ${displayValue}`,
    role: interactive ? 'button' : undefined,
    tabIndex: interactive ? 0 : undefined,
    onKeyDown: event => {
      if (interactive && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        setOpened(true);
      }
    },
  };
  const renderedTarget = target?.({ opened, buttonProps }) ?? (
    <Button variant="link" size="compact-xs" {...buttonProps}>
      {displayValue}
    </Button>
  );
  if (!interactive) return target ? renderedTarget : <>{displayValue}</>;
  return (
    <Menu
      opened={opened}
      onChange={setOpened}
      withinPortal
      position="bottom-start"
    >
      <Menu.Target>{renderedTarget}</Menu.Target>
      <Menu.Dropdown>
        <Menu.Item onClick={() => onSelect?.(false)}>Include</Menu.Item>
        <Menu.Item onClick={() => onSelect?.(true)}>Exclude</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
