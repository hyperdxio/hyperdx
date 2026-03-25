import { useMemo, useRef, useState } from 'react';
import { Accordion, Group, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';

import { FilterState } from '@/searchFilters';

import { FilterGroup } from '../DBSearchPageFilters';

import classes from '../../../styles/SearchPage.module.scss';

export type NestedFilterGroupProps = {
  name: string;
  childFilters: {
    key: string;
    value: (string | boolean)[];
    propertyPath: string;
  }[];
  selectedValues?: FilterState;
  onChange: (key: string, value: string | boolean) => void;
  onClearClick: (key: string) => void;
  onOnlyClick: (key: string, value: string | boolean) => void;
  onExcludeClick: (key: string, value: string | boolean) => void;
  onPinClick: (key: string, value: string | boolean) => void;
  isPinned: (key: string, value: string | boolean) => boolean;
  onFieldPinClick?: (key: string) => void;
  isFieldPinned?: (key: string) => boolean;
  onColumnToggle?: (column: string) => void;
  displayedColumns?: string[];
  onLoadMore: (key: string) => void;
  loadMoreLoading: Record<string, boolean>;
  hasLoadedMore: Record<string, boolean>;
  isDefaultExpanded?: boolean;
  'data-testid'?: string;
  chartConfig: any; // Using any to avoid importing ChartConfigWithDateRange
  isLive?: boolean;
};

const VIRTUAL_ITEM_HEIGHT_ESTIMATE = 26;
const MAX_VIRTUAL_LIST_HEIGHT = 350;

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
  onColumnToggle,
  displayedColumns,
  onLoadMore,
  loadMoreLoading,
  hasLoadedMore,
  isDefaultExpanded,
  'data-testid': dataTestId,
  chartConfig,
  isLive,
}: NestedFilterGroupProps) => {
  const totalFiltersSize = useMemo(
    () =>
      Object.values(selectedValues).reduce(
        (total, filter) => total + filter.included.size + filter.excluded.size,
        0,
      ),
    [selectedValues],
  );

  const hasSelections = totalFiltersSize > 0;
  const [isExpanded, setExpanded] = useState(
    isDefaultExpanded ?? hasSelections,
  );

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: isExpanded ? childFilters.length : 0,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => VIRTUAL_ITEM_HEIGHT_ESTIMATE,
    overscan: 10,
  });

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
            {isExpanded && (
              <div className={classes.filterGroupPanel}>
                {childFilters.length === 0 ? (
                  <Group m={6} gap="xs">
                    <Text c="dimmed" size="xs">
                      No properties found
                    </Text>
                  </Group>
                ) : (
                  <div
                    ref={scrollContainerRef}
                    style={{
                      maxHeight: MAX_VIRTUAL_LIST_HEIGHT,
                      overflow: 'auto',
                    }}
                  >
                    <div
                      style={{
                        height: `${rowVirtualizer.getTotalSize()}px`,
                        width: '100%',
                        position: 'relative',
                      }}
                    >
                      {rowVirtualizer.getVirtualItems().map(virtualRow => {
                        const child = childFilters[virtualRow.index];
                        const childSelectedValues = selectedValues[
                          child.key
                        ] || {
                          included: new Set(),
                          excluded: new Set(),
                        };
                        const childHasSelections =
                          childSelectedValues.included.size +
                            childSelectedValues.excluded.size >
                          0;

                        return (
                          <div
                            key={child.key}
                            data-index={virtualRow.index}
                            ref={rowVirtualizer.measureElement}
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              width: '100%',
                              transform: `translateY(${virtualRow.start}px)`,
                              paddingTop: 4,
                              paddingBottom: 4,
                            }}
                          >
                            <FilterGroup
                              data-testid={`nested-filter-group-${child.key}`}
                              name={child.propertyPath}
                              distributionKey={child.key}
                              options={child.value.map(value => ({
                                value: value,
                                label: value.toString(),
                              }))}
                              optionsLoading={false}
                              selectedValues={childSelectedValues}
                              onChange={value => onChange(child.key, value)}
                              onClearClick={() => onClearClick(child.key)}
                              onOnlyClick={value =>
                                onOnlyClick(child.key, value)
                              }
                              onExcludeClick={value =>
                                onExcludeClick(child.key, value)
                              }
                              onPinClick={value => onPinClick(child.key, value)}
                              isPinned={value => isPinned(child.key, value)}
                              onFieldPinClick={() =>
                                onFieldPinClick?.(child.key)
                              }
                              isFieldPinned={isFieldPinned?.(child.key)}
                              onColumnToggle={
                                onColumnToggle
                                  ? () => onColumnToggle(child.key)
                                  : undefined
                              }
                              isColumnDisplayed={displayedColumns?.includes(
                                child.key,
                              )}
                              onLoadMore={() => onLoadMore(child.key)}
                              loadMoreLoading={
                                loadMoreLoading[child.key] || false
                              }
                              hasLoadedMore={hasLoadedMore[child.key] || false}
                              isDefaultExpanded={childHasSelections}
                              chartConfig={chartConfig}
                              isLive={isLive}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Accordion.Panel>
        </div>
      </Accordion.Item>
    </Accordion>
  );
};
