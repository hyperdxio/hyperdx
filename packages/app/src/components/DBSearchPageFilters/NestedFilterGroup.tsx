import { useMemo, useState } from 'react';
import {
  Accordion,
  Group,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';

import { FilterGroup, TextButton } from '../DBSearchPageFilters';

import classes from '../../../styles/SearchPage.module.scss';

export type NestedFilterGroupProps = {
  name: string;
  childFilters: { key: string; value: string[]; propertyPath: string }[];
  selectedValues?: Record<
    string,
    { included: Set<string>; excluded: Set<string> }
  >;
  onChange: (key: string, value: string) => void;
  onClearClick: (key: string) => void;
  onOnlyClick: (key: string, value: string) => void;
  onExcludeClick: (key: string, value: string) => void;
  onPinClick: (key: string, value: string) => void;
  isPinned: (key: string, value: string) => boolean;
  onFieldPinClick?: (key: string) => void;
  isFieldPinned?: (key: string) => boolean;
  onLoadMore: (key: string) => void;
  loadMoreLoading: Record<string, boolean>;
  hasLoadedMore: Record<string, boolean>;
  isDefaultExpanded?: boolean;
  'data-testid'?: string;
  chartConfig: any; // Using any to avoid importing ChartConfigWithDateRange
  isLive?: boolean;
};

const emptyFn = () => {};

export const NestedFilterGroup = ({
  name,
  childFilters,
  selectedValues = {},
  onChange,
  onClearClick,
  onOnlyClick,
  onExcludeClick,
  onPinClick,
  isPinned,
  onFieldPinClick,
  isFieldPinned,
  onLoadMore,
  loadMoreLoading,
  hasLoadedMore,
  isDefaultExpanded,
  'data-testid': dataTestId,
  chartConfig,
  isLive,
}: NestedFilterGroupProps) => {
  const [isExpanded, setExpanded] = useState(isDefaultExpanded ?? false);

  const totalFiltersSize = useMemo(
    () =>
      Object.values(selectedValues).reduce(
        (total, filter) => total + filter.included.size + filter.excluded.size,
        0,
      ),
    [selectedValues],
  );

  const hasSelectedValues = totalFiltersSize > 0;

  return (
    <Accordion
      variant="unstyled"
      chevronPosition="left"
      classNames={{ chevron: classes.chevron }}
      value={isExpanded ? name : null}
      onChange={v => setExpanded(v === name)}
    >
      <Accordion.Item value={name} data-testid={dataTestId}>
        <div className={classes.filterGroup}>
          <div className={classes.filterGroupHeader}>
            <Accordion.Control
              component={UnstyledButton}
              flex="1"
              p="0"
              pr="xxxs"
              data-testid="nested-filter-group-control"
              classNames={{
                chevron: 'm-0',
                label: 'p-0',
              }}
              className={childFilters.length ? '' : 'opacity-50'}
            >
              <Tooltip
                openDelay={name.length > 26 ? 0 : 1500}
                label={name}
                position="top"
                withArrow
                fz="xxs"
                color="gray"
              >
                <Group gap="xs" wrap="nowrap" flex="1">
                  <Text size="xs" fw="500">
                    {name}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {`{${childFilters.length}}`}
                  </Text>
                </Group>
              </Tooltip>
            </Accordion.Control>
          </div>
          <Accordion.Panel
            data-testid="nested-filter-group-panel"
            classNames={{
              content: 'pl-3 pt-1 pb-0',
            }}
          >
            <div className={classes.filterGroupPanel}>
              <Stack gap="xs">
                {childFilters.map(child => (
                  <FilterGroup
                    key={child.key}
                    data-testid={`nested-filter-group-${child.key}`}
                    name={child.propertyPath}
                    distributionKey={child.key}
                    options={child.value.map(value => ({
                      value,
                      label: value,
                    }))}
                    optionsLoading={false}
                    selectedValues={
                      selectedValues[child.key] || {
                        included: new Set(),
                        excluded: new Set(),
                      }
                    }
                    onChange={value => onChange(child.key, value)}
                    onClearClick={() => onClearClick(child.key)}
                    onOnlyClick={value => onOnlyClick(child.key, value)}
                    onExcludeClick={value => onExcludeClick(child.key, value)}
                    onPinClick={value => onPinClick(child.key, value)}
                    isPinned={value => isPinned(child.key, value)}
                    onFieldPinClick={() => onFieldPinClick?.(child.key)}
                    isFieldPinned={isFieldPinned?.(child.key)}
                    onLoadMore={() => onLoadMore(child.key)}
                    loadMoreLoading={loadMoreLoading[child.key] || false}
                    hasLoadedMore={hasLoadedMore[child.key] || false}
                    isDefaultExpanded={false}
                    chartConfig={chartConfig}
                    isLive={isLive}
                  />
                ))}
              </Stack>
              {childFilters.length === 0 && (
                <Group m={6} gap="xs">
                  <Text c="dimmed" size="xs">
                    No properties found
                  </Text>
                </Group>
              )}
            </div>
          </Accordion.Panel>
        </div>
      </Accordion.Item>
    </Accordion>
  );
};
