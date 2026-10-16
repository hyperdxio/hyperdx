import { KeyboardEventHandler, memo, ReactElement, useState } from 'react';
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
    'aria-haspopup'?: 'menu';
    'aria-expanded'?: boolean;
    onClick: () => void;
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

export default memo(function NetflowFilterMenu(props: Props) {
  const [opened, setOpened] = useState(false);
  const [activated, setActivated] = useState(false);
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
    'aria-haspopup': interactive ? 'menu' : undefined,
    'aria-expanded': interactive ? opened : undefined,
    onClick: () => {
      if (interactive && !activated) {
        setActivated(true);
        setOpened(true);
      }
    },
    role: interactive ? 'button' : undefined,
    tabIndex: interactive ? 0 : undefined,
    onKeyDown: event => {
      if (interactive && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        setActivated(true);
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
  // Flow tables can have thousands of filter cells; create a popover only when used.
  if (!activated) return renderedTarget;
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
});
