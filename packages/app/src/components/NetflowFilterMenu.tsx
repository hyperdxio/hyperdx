import { Button, Menu } from '@mantine/core';

export type NetflowFilterField =
  | 'srcAddr'
  | 'dstAddr'
  | 'protocol'
  | 'exporter'
  | 'inputInterface'
  | 'outputInterface';

export type NetflowFilterHandler = (
  field: NetflowFilterField,
  value: string,
  excluded: boolean,
) => void;

export default function NetflowFilterMenu({
  field,
  value,
  onFilter,
}: {
  field: NetflowFilterField;
  value: string;
  onFilter?: NetflowFilterHandler;
}) {
  if (!value.trim() || !onFilter) return <>{value || '—'}</>;

  return (
    <Menu withinPortal position="bottom-start">
      <Menu.Target>
        <Button
          variant="link"
          size="compact-xs"
          aria-label={`Filter ${field}: ${value}`}
        >
          {value}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item onClick={() => onFilter(field, value, false)}>
          Include
        </Menu.Item>
        <Menu.Item onClick={() => onFilter(field, value, true)}>
          Exclude
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
