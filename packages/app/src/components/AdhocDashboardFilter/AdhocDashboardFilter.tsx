import { useState } from 'react';
import {
  AdhocDashboardFilter as AdhocDashboardFilterType,
  AdhocFilterCondition,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  CloseButton,
  Group,
  Popover,
  Stack,
  Text,
} from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';

import { DashboardFilterLabel } from '@/components/DashboardFilterLabel';
import { FilterPill, getFilterOperators } from '@/components/FilterPill';

import { AdhocConditionEditor } from './AdhocConditionEditor';

type AdhocDashboardFilterProps = {
  filter: AdhocDashboardFilterType;
  conditions: AdhocFilterCondition[];
  onChange: (conditions: AdhocFilterCondition[]) => void;
  dateRange: [Date, Date];
  effect: { hasEffect: boolean; tooltip: string };
};

/** A dashboard filter bar control holding one ad hoc filter's conditions. */
export function AdhocDashboardFilter({
  filter,
  conditions,
  onChange,
  dateRange,
  effect,
}: AdhocDashboardFilterProps) {
  const [isAdding, setIsAdding] = useState(false);
  const operators = getFilterOperators(filter.sourceType);

  const add = (condition: AdhocFilterCondition) =>
    onChange([...conditions, condition]);
  const replace = (index: number, condition: AdhocFilterCondition) =>
    onChange(
      conditions.map((existing, i) => (i === index ? condition : existing)),
    );
  const remove = (index: number) =>
    onChange(conditions.filter((_existing, i) => i !== index));

  return (
    <Stack gap={2} data-testid={`adhoc-filter-${filter.name}`}>
      <DashboardFilterLabel name={filter.name} effect={effect} />
      <Group
        gap={4}
        w={250}
        mih={30}
        px={6}
        py={4}
        wrap="wrap"
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--mantine-radius-sm)',
        }}
      >
        {conditions.map((condition, index) => {
          const operator = operators.find(
            op => op.value === condition.operator,
          );
          return (
            <FilterPill
              key={JSON.stringify(condition)}
              field={condition.key}
              operator={operator?.label ?? condition.operator}
              value={condition.value}
              isExcluded={!!operator?.negated}
              onRemove={() => remove(index)}
              renderPopover={close => (
                <AdhocConditionEditor
                  filter={filter}
                  dateRange={dateRange}
                  initial={condition}
                  onSubmit={next => {
                    replace(index, next);
                    close();
                  }}
                />
              )}
              data-testid="adhoc-condition-pill"
            />
          );
        })}
        {conditions.length === 0 && (
          <Text
            size="xs"
            c="dimmed"
            onClick={() => setIsAdding(true)}
            style={{ cursor: 'pointer', flex: 1 }}
          >
            {filter.name}
          </Text>
        )}
        <Group gap={0} wrap="nowrap" ml="auto">
          {conditions.length > 0 && (
            <CloseButton
              size="xs"
              aria-label={`Clear ${filter.name} conditions`}
              onClick={() => onChange([])}
              data-testid={`adhoc-filter-clear-${filter.name}`}
            />
          )}
          <Popover
            opened={isAdding}
            onChange={setIsAdding}
            position="bottom-start"
            withArrow
            shadow="md"
            radius="sm"
          >
            <Popover.Target>
              <ActionIcon
                variant="subtle"
                size="sm"
                aria-label={`Add ${filter.name} condition`}
                onClick={() => setIsAdding(!isAdding)}
                data-testid={`adhoc-filter-add-${filter.name}`}
              >
                <IconPlus size={14} />
              </ActionIcon>
            </Popover.Target>
            <Popover.Dropdown p={6}>
              <AdhocConditionEditor
                filter={filter}
                dateRange={dateRange}
                onSubmit={condition => {
                  add(condition);
                  setIsAdding(false);
                }}
              />
            </Popover.Dropdown>
          </Popover>
        </Group>
      </Group>
    </Stack>
  );
}
