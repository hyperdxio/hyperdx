import { useState } from 'react';
import { isAdhocConditionSupported } from '@hyperdx/common-utils/dist/filters';
import {
  ADHOC_FILTER_MAX_CONDITIONS,
  AdhocDashboardFilter as AdhocDashboardFilterType,
  AdhocFilterCondition,
  AdhocFilterConditionSchema,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  CloseButton,
  Group,
  Popover,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';

import {
  DashboardFilterLabel,
  FilterEffect,
} from '@/components/DashboardFilterLabel';
import { FilterPill, getFilterOperatorDisplay } from '@/components/FilterPill';

import { AdhocConditionEditor } from './AdhocConditionEditor';
import {
  notifyAdhocConditionTooLong,
  notifyAdhocFilterFull,
} from './notifications';

type AdhocDashboardFilterProps = {
  filter: AdhocDashboardFilterType;
  conditions: AdhocFilterCondition[];
  onChange: (conditions: AdhocFilterCondition[]) => void;
  dateRange: [Date, Date];
  effect: FilterEffect;
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
  const isAtLimit = conditions.length >= ADHOC_FILTER_MAX_CONDITIONS;

  const toggleAdding = () => {
    if (isAtLimit) {
      notifyAdhocFilterFull(filter);
      return;
    }
    setIsAdding(!isAdding);
  };
  // The URL parser drops an invalid entry whole, so one bad condition would
  // lose the filter's others on reload. Keep the editor open to fix it instead.
  const isStorable = (condition: AdhocFilterCondition) => {
    if (AdhocFilterConditionSchema.safeParse(condition).success) return true;
    notifyAdhocConditionTooLong(filter);
    return false;
  };
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
          const operator = getFilterOperatorDisplay(
            filter.sourceType,
            condition.operator,
          );
          return (
            <FilterPill
              key={JSON.stringify(condition)}
              field={condition.key}
              operator={operator.label}
              value={condition.value}
              isExcluded={operator.isExcluded}
              isInvalid={
                !isAdhocConditionSupported(filter.sourceType, condition)
              }
              invalidReason={`Filter not applied: PromQL has no ${condition.operator} operator. Remove this condition and add it again with a supported operator.`}
              onRemove={() => remove(index)}
              renderPopover={close => (
                <AdhocConditionEditor
                  filter={filter}
                  dateRange={dateRange}
                  initial={condition}
                  onSubmit={next => {
                    if (!isStorable(next)) return;
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
              <Tooltip
                label={`Up to ${ADHOC_FILTER_MAX_CONDITIONS} conditions`}
                disabled={!isAtLimit}
                withinPortal
              >
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  aria-label={`Add ${filter.name} condition`}
                  aria-disabled={isAtLimit}
                  data-disabled={isAtLimit || undefined}
                  onClick={toggleAdding}
                  data-testid={`adhoc-filter-add-${filter.name}`}
                >
                  <IconPlus size={14} />
                </ActionIcon>
              </Tooltip>
            </Popover.Target>
            <Popover.Dropdown p={6}>
              <AdhocConditionEditor
                filter={filter}
                dateRange={dateRange}
                onSubmit={condition => {
                  if (!isStorable(condition)) return;
                  onChange([...conditions, condition]);
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
