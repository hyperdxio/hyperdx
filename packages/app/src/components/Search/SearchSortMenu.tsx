import { useState } from 'react';
import {
  Box,
  Button,
  Divider,
  Popover,
  SegmentedControl,
  Stack,
  Text,
} from '@mantine/core';
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

function OptionRow({
  icon,
  label,
  active,
  onClick,
}: {
  icon?: React.ReactNode;
  label: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="subtle"
      color="gray"
      size="xs"
      fullWidth
      justify="space-between"
      leftSection={icon}
      rightSection={active ? <IconCheck size={14} /> : <Box w={14} h={14} />}
      onClick={onClick}
      styles={{ label: { fontWeight: 400 } }}
    >
      {label}
    </Button>
  );
}

/**
 * Structured sort control that replaces the free-form ORDER BY editor. For
 * aggregated views the options are Value / Name (the metric vs. the group key);
 * for the List view they are the displayed columns. Pass `sqlSlot` to offer a
 * "SQL" toggle that swaps the structured UI for a raw ORDER BY editor.
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
  sqlSlot,
}: {
  groupLabel?: string;
  options: SortFieldOption[];
  activeField?: string;
  direction: SortDirection;
  onChange: (field: string, direction: SortDirection) => void;
  onRevert?: () => void;
  canRevert?: boolean;
  disabled?: boolean;
  sqlSlot?: React.ReactNode;
}) {
  const [mode, setMode] = useState<'visual' | 'sql'>('visual');

  const setField = (field: string) => onChange(field, direction);
  const setDirection = (dir: SortDirection) =>
    onChange(activeField ?? options[0]?.value ?? '', dir);

  return (
    <Popover position="bottom-end" withinPortal shadow="md" width={240}>
      <Popover.Target>
        <Button
          variant="secondary"
          size="xs"
          disabled={disabled}
          leftSection={<IconArrowsSort size={14} />}
          rightSection={<IconChevronDown size={14} />}
          data-testid="search-sort-menu"
        >
          Sort
        </Button>
      </Popover.Target>
      <Popover.Dropdown p="xs">
        {Boolean(sqlSlot) && (
          <SegmentedControl
            fullWidth
            size="xs"
            mb="xs"
            value={mode}
            onChange={value => setMode(value as 'visual' | 'sql')}
            data={[
              { label: 'Sort', value: 'visual' },
              { label: 'SQL', value: 'sql' },
            ]}
          />
        )}
        {mode === 'sql' && sqlSlot ? (
          <Box>{sqlSlot}</Box>
        ) : (
          <Stack gap={2}>
            <Text size="xxs" c="dimmed" fw={700} tt="uppercase" px="xs">
              {groupLabel}
            </Text>
            {options.map(option => (
              <OptionRow
                key={option.value}
                icon={option.icon}
                label={option.label}
                active={activeField === option.value}
                onClick={() => setField(option.value)}
              />
            ))}
            <Divider my={4} />
            <Text size="xxs" c="dimmed" fw={700} tt="uppercase" px="xs">
              Direction
            </Text>
            <OptionRow
              icon={<IconArrowUp size={14} />}
              label="Ascending"
              active={direction === 'asc'}
              onClick={() => setDirection('asc')}
            />
            <OptionRow
              icon={<IconArrowDown size={14} />}
              label="Descending"
              active={direction === 'desc'}
              onClick={() => setDirection('desc')}
            />
            {onRevert && (
              <>
                <Divider my={4} />
                <Button
                  variant="subtle"
                  color="gray"
                  size="xs"
                  fullWidth
                  disabled={!canRevert}
                  onClick={onRevert}
                >
                  Revert sort
                </Button>
              </>
            )}
          </Stack>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
