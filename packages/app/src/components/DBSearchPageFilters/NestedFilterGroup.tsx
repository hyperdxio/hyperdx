import { useMemo, useRef, useState } from 'react';
import { FilterState } from '@hyperdx/common-utils/dist/filters';
import { Accordion, Group, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';

import { FilterGroup } from '@/components/DBSearchPageFilters';
import {
  FILTER_SEARCH_MIN_ITEMS,
  FilterSearchInput,
} from '@/components/DBSearchPageFilters/FilterSearchInput';
import type { FacetEntry } from '@/components/DBSearchPageFilters/utils';
import { isColumnInSelect } from '@/utils';

import classes from '@styles/SearchPage.module.scss';

type NestedFilterGroupProps = {
  name: string;
  childFilters: (FacetEntry & {
    propertyPath: string;
    // Canonical (quoted/bracket) SQL form of `key`, used wherever the key
    // becomes a raw SQL expression (distribution query, "Add column" SELECT).
    // Falls back to `key` when absent.
    sqlKey?: string;
  })[];
  selectedValues?: FilterState;
  onChange: (key: string, value: string | boolean) => void;
  onClearClick: (key: string) => void;
  onOnlyClick: (key: string, value: string | boolean) => void;
  onExcludeClick: (key: string, value: string | boolean) => void;
  onPinClick: (key: string, value: string | boolean) => void;
  isPinned: (key: string, value: string | boolean) => boolean;
  onSharedPinClick?: (key: string, value: string | boolean) => void;
  isSharedPinned?: (key: string, value: string | boolean) => boolean;
  onFieldPinClick?: (key: string) => void;
  isFieldPinned?: (key: string) => boolean;
  onToggleSharedFieldPin?: (key: string) => void;
  isSharedFieldPinned?: (key: string) => boolean;
  showFilterCounts?: boolean;
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

type ChildState = {
  expanded: boolean;
  showDistributions?: boolean;
  hadSelections: boolean;
};

const VIRTUAL_ITEM_HEIGHT_ESTIMATE = 26;
const MAX_VIRTUAL_LIST_HEIGHT = 350;

export const NestedFilterGroup = ({
  name,
  childFilters,
  selectedValues: _selectedValues,
  onChange,
  onClearClick,
  onOnlyClick,
  onExcludeClick,
  onPinClick,
  isPinned,
  onSharedPinClick,
  isSharedPinned,
  onFieldPinClick,
  isFieldPinned,
  onToggleSharedFieldPin,
  isSharedFieldPinned,
  showFilterCounts,
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
  const selectedValues: FilterState = useMemo(
    () => _selectedValues ?? {},
    [_selectedValues],
  );

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

  const [search, setSearch] = useState('');
  const matchingChildFilters = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return childFilters;
    return childFilters.filter(child =>
      child.propertyPath.toLowerCase().includes(query),
    );
  }, [childFilters, search]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const keyHasSelections = (key: string) => {
    const entry = selectedValues[key];
    return entry != null && entry.included.size + entry.excluded.size > 0;
  };
  // Rows unmount when scrolled out of view, so their state lives here. Like
  // regular filter groups, a key expands when it gains a filter (including one
  // added outside the sidebar) and keeps its state when it loses one.
  const [childState, setChildState] = useState<Record<string, ChildState>>({});
  const updateChildState = (key: string, patch: Partial<ChildState>) =>
    setChildState(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  const changedKeys = Object.keys({ ...selectedValues, ...childState }).filter(
    key => (childState[key]?.hadSelections ?? false) !== keyHasSelections(key),
  );
  if (changedKeys.length > 0) {
    setChildState(prev => {
      const next = { ...prev };
      for (const key of changedKeys) {
        next[key] = keyHasSelections(key)
          ? { ...prev[key], expanded: true, hadSelections: true }
          : { ...prev[key], hadSelections: false };
      }
      return next;
    });
  }

  const rowVirtualizer = useVirtualizer({
    count: isExpanded ? matchingChildFilters.length : 0,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => VIRTUAL_ITEM_HEIGHT_ESTIMATE,
    overscan: 10,
    getItemKey: index => matchingChildFilters[index]?.key ?? index,
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
                  <Text size="xs" fw="500" truncate="end">
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
              content: 'px-0 pb-0',
            }}
            pt={1}
            pb={0}
            pl="xs"
          >
            <div className={classes.filterGroupPanel}>
              {childFilters.length > FILTER_SEARCH_MIN_ITEMS && (
                <FilterSearchInput
                  placeholder="Search keys..."
                  value={search}
                  data-testid={`nested-filter-search-${name}`}
                  onChange={setSearch}
                />
              )}
              {matchingChildFilters.length === 0 ? (
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
                      const child = matchingChildFilters[virtualRow.index];
                      const childSelectedValues = selectedValues[child.key] || {
                        included: new Set(),
                        excluded: new Set(),
                      };
                      const childHasSelections = keyHasSelections(child.key);

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
                            distributionKey={child.sqlKey ?? child.key}
                            options={child.value.map(value => ({
                              value: value,
                              label: value.toString(),
                            }))}
                            optionsLoading={child.isLoading ?? false}
                            selectedValues={childSelectedValues}
                            onChange={value => onChange(child.key, value)}
                            onClearClick={() => onClearClick(child.key)}
                            onOnlyClick={value => onOnlyClick(child.key, value)}
                            onExcludeClick={value =>
                              onExcludeClick(child.key, value)
                            }
                            valuePins={{
                              onPinClick: value => onPinClick(child.key, value),
                              isPinned: value => isPinned(child.key, value),
                              onSharedPinClick: onSharedPinClick
                                ? value => onSharedPinClick(child.key, value)
                                : undefined,
                              isSharedPinned: isSharedPinned
                                ? value => isSharedPinned(child.key, value)
                                : undefined,
                            }}
                            fieldPins={{
                              onFieldPinClick: () =>
                                onFieldPinClick?.(child.key),
                              isFieldPinned: isFieldPinned?.(child.key),
                              onToggleSharedFieldPin: () =>
                                onToggleSharedFieldPin?.(child.key),
                              isSharedFieldPinned: isSharedFieldPinned?.(
                                child.key,
                              ),
                            }}
                            onColumnToggle={
                              onColumnToggle
                                ? () =>
                                    onColumnToggle(child.sqlKey ?? child.key)
                                : undefined
                            }
                            isColumnDisplayed={isColumnInSelect(
                              displayedColumns,
                              child.sqlKey ?? child.key,
                            )}
                            onLoadMore={() => onLoadMore(child.key)}
                            loadMoreLoading={
                              loadMoreLoading[child.key] || false
                            }
                            hasLoadedMore={hasLoadedMore[child.key] || false}
                            showFilterCounts={showFilterCounts}
                            expanded={
                              childState[child.key]?.expanded ??
                              childHasSelections
                            }
                            onExpandedChange={expanded =>
                              updateChildState(child.key, {
                                expanded,
                                hadSelections: childHasSelections,
                              })
                            }
                            showDistributions={
                              childState[child.key]?.showDistributions ?? false
                            }
                            onShowDistributionsChange={showDistributions =>
                              updateChildState(child.key, { showDistributions })
                            }
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
          </Accordion.Panel>
        </div>
      </Accordion.Item>
    </Accordion>
  );
};
