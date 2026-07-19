import { Button, Menu, Text } from '@mantine/core';
import {
  IconArrowDown,
  IconArrowsSort,
  IconArrowUp,
  IconCheck,
  IconChevronDown,
} from '@tabler/icons-react';

export type SortDirection = 'asc' | 'desc';

export type SortFieldOption = {
  value: string;
  label: string;
  icon?: React.ReactNode;
};

/**
 * Structured sort control that replaces the free-form ORDER BY editor. For
 * aggregated views the options are Value / Name (the metric vs. the group key);
 * for the List view they are the displayed columns.
 */
export function SearchSortMenu({
  groupLabel = 'Sort by',
  options,
  activeField,
  direction,
  onChange,
  onRevert,
  canRevert,
  disabled,
}: {
  groupLabel?: string;
  options: SortFieldOption[];
  activeField?: string;
  direction: SortDirection;
  onChange: (field: string, direction: SortDirection) => void;
  onRevert?: () => void;
  canRevert?: boolean;
  disabled?: boolean;
}) {
  const setField = (field: string) => onChange(field, direction);
  const setDirection = (dir: SortDirection) =>
    onChange(activeField ?? options[0]?.value ?? '', dir);

  return (
    <Menu position="bottom-end" withinPortal shadow="md" width={240}>
      <Menu.Target>
        <Button
          variant="subtle"
          color="gray"
          size="xs"
          disabled={disabled}
          leftSection={<IconArrowsSort size={14} />}
          rightSection={<IconChevronDown size={14} />}
          data-testid="search-sort-menu"
        >
          Sort
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>
          <Text size="xxs" c="dimmed" fw={700} tt="uppercase">
            {groupLabel}
          </Text>
        </Menu.Label>
        {options.map(option => (
          <Menu.Item
            key={option.value}
            leftSection={option.icon}
            rightSection={
              activeField === option.value ? <IconCheck size={14} /> : null
            }
            onClick={() => setField(option.value)}
          >
            {option.label}
          </Menu.Item>
        ))}
        <Menu.Divider />
        <Menu.Label>
          <Text size="xxs" c="dimmed" fw={700} tt="uppercase">
            Direction
          </Text>
        </Menu.Label>
        <Menu.Item
          leftSection={<IconArrowUp size={14} />}
          rightSection={direction === 'asc' ? <IconCheck size={14} /> : null}
          onClick={() => setDirection('asc')}
        >
          Ascending
        </Menu.Item>
        <Menu.Item
          leftSection={<IconArrowDown size={14} />}
          rightSection={direction === 'desc' ? <IconCheck size={14} /> : null}
          onClick={() => setDirection('desc')}
        >
          Descending
        </Menu.Item>
        {onRevert && (
          <>
            <Menu.Divider />
            <Menu.Item
              disabled={!canRevert}
              onClick={onRevert}
              ta="center"
              c="dimmed"
            >
              Revert sort
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
