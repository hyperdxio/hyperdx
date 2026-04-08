import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import cx from 'classnames';
import {
  TableMetadata,
  tcFromSource,
} from '@hyperdx/common-utils/dist/core/metadata';
import {
  BuilderChartConfigWithDateRange,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import {
  Accordion,
  ActionIcon,
  Box,
  Button,
  Center,
  Checkbox,
  Flex,
  Group,
  Loader,
  MantineStyleProps,
  Menu,
  NumberInput,
  ScrollArea,
  Stack,
  Tabs,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconArrowBarToLeft,
  IconChartBar,
  IconChartBarOff,
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconFilterOff,
  IconMinus,
  IconPin,
  IconPinFilled,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconShadow,
  IconSitemap,
  IconUsers,
} from '@tabler/icons-react';

import { IS_CLICKHOUSE_BUILD } from '@/config';
import {
  useAllFields,
  useColumns,
  useGetKeyValues,
  useGetValuesDistribution,
  useJsonColumns,
  useTableMetadata,
} from '@/hooks/useMetadata';
import { useMetadataWithSettings } from '@/hooks/useMetadata';
import useResizable from '@/hooks/useResizable';
import { usePinnedFiltersApi } from '@/pinnedFilters';
import {
  type FilterState,
  FilterStateHook,
  IS_ROOT_SPAN_COLUMN_NAME,
  usePinnedFilters,
} from '@/searchFilters';
import { useSource } from '@/source';
import { mergePath, useLocalStorage } from '@/utils';

import { FilterSettingsPanel } from './DBSearchPageFilters/FilterSettingsPopover';
import { NestedFilterGroup } from './DBSearchPageFilters/NestedFilterGroup';
import { SharedFiltersSection } from './DBSearchPageFilters/SharedFilters';
import { groupFacetsByBaseName } from './DBSearchPageFilters/utils';

import resizeStyles from '../../styles/ResizablePanel.module.scss';
import classes from '../../styles/SearchPage.module.scss';

/* The initial number of values per filter to load */
const INITIAL_LOAD_LIMIT = 20;

/* The maximum number of values per filter to load when "Load More" is clicked */
const LOAD_MORE_LOAD_LIMIT = 10000;

/* The initial number of values per filter to render */
const INITIAL_MAX_VALUES_DISPLAYED = 10;

/* The maximum number of values per filter to render at once after loading more */
const SHOW_MORE_MAX_VALUES_DISPLAYED = 50;

// This function will clean json string attributes specifically. It will turn a string like
// 'toString(ResourceAttributes.`hdx`.`sdk`.`version`)' into 'ResourceAttributes.hdx.sdk.version'.
export function cleanedFacetName(key: string): string {
  if (key.startsWith('toString')) {
    return key
      .slice('toString('.length, key.length - 1)
      .split('.')
      .map(str =>
        str.startsWith('`') && str.endsWith('`') ? str.slice(1, -1) : str,
      )
      .join('.');
  }
  return key;
}

/** Value-level pin callbacks and state (personal + shared). */
export type ValuePinHandlers = {
  onPinClick: (value: string | boolean) => void;
  isPinned: (value: string | boolean) => boolean;
  onSharedPinClick?: (value: string | boolean) => void;
  isSharedPinned?: (value: string | boolean) => boolean;
};

/** Field/group-level pin callbacks and state (personal + shared). */
export type FieldPinHandlers = {
  onFieldPinClick?: VoidFunction;
  isFieldPinned?: boolean;
  onToggleSharedFieldPin?: VoidFunction;
  isSharedFieldPinned?: boolean;
};

type FilterCheckboxProps = {
  columnName: string;
  label: string;
  value?: 'included' | 'excluded' | false;
  pinned: boolean;
  sharedPinned?: boolean;
  onChange?: (checked: boolean) => void;
  onClickOnly?: VoidFunction;
  onClickExclude?: VoidFunction;
  onClickPin: VoidFunction;
  onClickSharedPin?: VoidFunction;
  className?: string;
  percentage?: number;
  isPercentageLoading?: boolean;
};

const TextButton = ({
  onClick,
  label,
  ms,
  display,
  'data-testid': dataTestId,
}: {
  onClick?: VoidFunction;
  label: React.ReactNode;
  ms?: MantineStyleProps['ms'];
  display?: MantineStyleProps['display'];
  'data-testid'?: string;
}) => {
  return (
    <UnstyledButton
      display={display}
      onClick={onClick}
      className={classes.textButton}
      data-testid={dataTestId}
    >
      <Text size="xxs" lh={1} ms={ms}>
        {label}
      </Text>
    </UnstyledButton>
  );
};

/**
 * Shared pin/share dropdown menu used on both value rows and group headers.
 * Shows contextual actions: "Remove from Shared" / "Pin for me" / "Share with team"
 * with the most relevant action first.
 *
 * Icon logic:
 *  - sharedPinned → IconUsers (people icon)
 *  - personalPinned → IconPinFilled
 *  - neither → IconPin (outline)
 */
function PinShareMenu({
  personalPinned,
  sharedPinned,
  onTogglePersonalPin,
  onToggleSharedPin,
  size = 14,
  onChange,
  'data-testid': dataTestId,
  'aria-label': ariaLabel,
}: {
  personalPinned: boolean;
  sharedPinned: boolean;
  onTogglePersonalPin: VoidFunction;
  onToggleSharedPin?: VoidFunction;
  size?: number;
  onChange?: (opened: boolean) => void;
  'data-testid'?: string;
  'aria-label'?: string;
}) {
  const isPinnedAny = personalPinned || sharedPinned;

  // Personal pin icon takes priority over shared icon
  const triggerIcon = personalPinned ? (
    <IconPinFilled size={size} />
  ) : sharedPinned ? (
    <IconUsers size={size} />
  ) : (
    <IconPin size={size} />
  );

  return (
    <Menu
      position="right"
      withArrow
      shadow="sm"
      width={200}
      onChange={onChange}
    >
      <Menu.Target>
        <ActionIcon
          size="xs"
          variant="subtle"
          color="gray"
          aria-label={ariaLabel ?? (isPinnedAny ? 'Unpin' : 'Pin')}
          data-testid={dataTestId}
        >
          {triggerIcon}
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {onToggleSharedPin && sharedPinned && (
          <Menu.Item
            leftSection={<IconUsers size={14} />}
            onClick={onToggleSharedPin}
            fz="xs"
          >
            Remove from Shared
          </Menu.Item>
        )}
        <Menu.Item
          leftSection={
            personalPinned ? <IconPinFilled size={14} /> : <IconPin size={14} />
          }
          onClick={onTogglePersonalPin}
          fz="xs"
        >
          {personalPinned ? 'Unpin for me' : 'Pin for me'}
        </Menu.Item>
        {onToggleSharedPin && !sharedPinned && (
          <Menu.Item
            leftSection={<IconUsers size={14} />}
            onClick={onToggleSharedPin}
            fz="xs"
          >
            Share with team
          </Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}

/**
 * Small indicator icon shown persistently on pinned/shared values.
 */
function PinShareIndicator({
  personalPinned,
  sharedPinned,
  'data-testid': dataTestId,
}: {
  personalPinned: boolean;
  sharedPinned: boolean;
  'data-testid'?: string;
}) {
  if (!personalPinned && !sharedPinned) return null;

  // Personal pin icon takes priority over shared icon
  return (
    <Center me="1px">
      {personalPinned ? (
        <IconPinFilled size={12} data-testid={dataTestId} />
      ) : (
        <IconUsers size={12} data-testid={dataTestId} />
      )}
    </Center>
  );
}

type FilterPercentageProps = {
  percentage: number;
  isLoading?: boolean;
};

const FilterPercentage = ({ percentage, isLoading }: FilterPercentageProps) => {
  const formattedPercentage =
    percentage < 1
      ? `<1%`
      : percentage >= 99.5
        ? `>99%`
        : `~${Math.round(percentage)}%`;

  return (
    <Text size="xs" className={isLoading ? 'effect-pulse' : ''}>
      {formattedPercentage}
    </Text>
  );
};

const FilterCheckbox = ({
  columnName,
  value,
  label,
  pinned,
  sharedPinned,
  onChange,
  onClickOnly,
  onClickExclude,
  onClickPin,
  onClickSharedPin,
  className,
  percentage,
  isPercentageLoading,
}: FilterCheckboxProps) => {
  const [pinMenuOpened, setPinMenuOpened] = useState(false);
  const testIdPrefix = `filter-checkbox-${columnName}-${label}`;
  const isPinnedAny = pinned || sharedPinned;
  return (
    <div
      className={cx(classes.filterCheckbox, className)}
      data-testid={testIdPrefix}
      // Keep actions visible while pin menu is open
      style={
        pinMenuOpened
          ? { backgroundColor: 'var(--color-bg-surface)' }
          : undefined
      }
    >
      <Group
        gap={8}
        onClick={() => onChange?.(!value)}
        style={{ minWidth: 0 }}
        wrap="nowrap"
      >
        <Checkbox
          checked={!!value}
          size={13 as any}
          onChange={() => {
            // taken care by the onClick in the group
          }}
          indeterminate={value === 'excluded'}
          data-testid={`${testIdPrefix}-input`}
        />
        <Tooltip
          openDelay={label.length > 22 ? 0 : 1500}
          label={label}
          position="right"
          withArrow
          fz="xxs"
          color="gray"
        >
          <Group
            w="100%"
            gap="xs"
            wrap="nowrap"
            justify="space-between"
            pe={'4px'}
            miw={0}
          >
            <Text
              size="xs"
              c={
                value === 'excluded'
                  ? 'var(--color-text-danger)'
                  : 'var(--color-text)'
              }
              truncate="end"
              flex={1}
              title={label}
            >
              {label || <span className="fst-italic">(empty)</span>}
            </Text>
            {percentage != null && (
              <FilterPercentage
                percentage={percentage}
                isLoading={isPercentageLoading}
              />
            )}
          </Group>
        </Tooltip>
      </Group>
      <div
        className={classes.filterActions}
        style={pinMenuOpened ? { display: 'flex' } : undefined}
      >
        {onClickOnly && (
          <TextButton
            onClick={onClickOnly}
            label="Only"
            data-testid={`${testIdPrefix}-only`}
          />
        )}
        {onClickExclude && (
          <TextButton
            onClick={onClickExclude}
            label="Exclude"
            data-testid={`${testIdPrefix}-exclude`}
          />
        )}
        <PinShareMenu
          personalPinned={pinned}
          sharedPinned={sharedPinned ?? false}
          onTogglePersonalPin={onClickPin}
          onToggleSharedPin={onClickSharedPin}
          size={12}
          onChange={setPinMenuOpened}
          data-testid={`${testIdPrefix}-pin`}
          aria-label={isPinnedAny ? 'Unpin value' : 'Pin value'}
        />
      </div>
      <PinShareIndicator
        personalPinned={pinned}
        sharedPinned={sharedPinned ?? false}
        data-testid={
          sharedPinned
            ? `${testIdPrefix}-pin-shared`
            : `${testIdPrefix}-pin-pinned`
        }
      />
    </div>
  );
};

const FilterRangeDisplay = ({
  range,
  onRangeChange,
}: {
  name: string;
  range: { min: number; max: number };
  onClearClick: VoidFunction;
  onRangeChange?: (range: { min: number; max: number }) => void;
}) => {
  const [localMin, setLocalMin] = useState(range.min);
  const [localMax, setLocalMax] = useState(range.max);

  const handleMinChange = (value: number | string) => {
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    if (!isNaN(numValue)) {
      setLocalMin(numValue);
      if (onRangeChange) {
        onRangeChange({ min: numValue, max: localMax });
      }
    }
  };

  const handleMaxChange = (value: number | string) => {
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    if (!isNaN(numValue)) {
      setLocalMax(numValue);
      if (onRangeChange) {
        onRangeChange({ min: localMin, max: numValue });
      }
    }
  };

  return (
    <Stack gap={8} px="xs" mb="xs">
      <Group gap={4} wrap="nowrap">
        <NumberInput
          size="xs"
          placeholder="Min"
          value={localMin}
          onChange={handleMinChange}
          styles={{ input: { fontSize: '11px' } }}
          flex={1}
          hideControls
        />
        <Text size="xs" c="dimmed">
          to
        </Text>
        <NumberInput
          size="xs"
          placeholder="Max"
          value={localMax}
          onChange={handleMaxChange}
          styles={{ input: { fontSize: '11px' } }}
          flex={1}
          hideControls
        />
      </Group>
    </Stack>
  );
};

type SelectedValues = {
  included: Set<string | boolean>;
  excluded: Set<string | boolean>;
  range?: { min: number; max: number };
};

export type FilterGroupProps = {
  name: string;
  options: { value: string | boolean; label: string }[];
  optionsLoading?: boolean;
  selectedValues?: SelectedValues;
  onChange: (value: string | boolean) => void;
  onClearClick: VoidFunction;
  onOnlyClick: (value: string | boolean) => void;
  onExcludeClick: (value: string | boolean) => void;
  valuePins: ValuePinHandlers;
  fieldPins?: FieldPinHandlers;
  onColumnToggle?: VoidFunction;
  isColumnDisplayed?: boolean;
  onLoadMore: (key: string) => void;
  loadMoreLoading: boolean;
  hasLoadedMore: boolean;
  isDefaultExpanded?: boolean;
  showFilterCounts?: boolean;
  'data-testid'?: string;
  chartConfig: BuilderChartConfigWithDateRange;
  isLive?: boolean;
  onRangeChange?: (range: { min: number; max: number }) => void;
  distributionKey?: string;
};

/**
 * Inner body of a FilterGroup — only mounted when expanded.
 * All expensive hooks (useGetValuesDistribution, sorting memos, etc.)
 * live here so collapsed groups pay near-zero cost.
 */
const FilterGroupBody = ({
  name,
  options,
  optionsLoading,
  selectedValues,
  onChange,
  onOnlyClick,
  onExcludeClick,
  isPinned,
  onPinClick,
  isSharedPinned,
  onSharedPinClick,
  onLoadMore,
  loadMoreLoading,
  hasLoadedMore,
  chartConfig,
  isLive,
  distributionKey,
  showDistributions,
  onDistributionError,
  onFetchingDistributionChange,
}: {
  name: string;
  options: { value: string | boolean; label: string }[];
  optionsLoading?: boolean;
  selectedValues: SelectedValues;
  onChange: (value: string | boolean) => void;
  onOnlyClick: (value: string | boolean) => void;
  onExcludeClick: (value: string | boolean) => void;
  isPinned: (value: string | boolean) => boolean;
  onPinClick: (value: string | boolean) => void;
  isSharedPinned?: (value: string | boolean) => boolean;
  onSharedPinClick?: (value: string | boolean) => void;
  onLoadMore: (key: string) => void;
  loadMoreLoading: boolean;
  hasLoadedMore: boolean;
  chartConfig: BuilderChartConfigWithDateRange;
  isLive?: boolean;
  distributionKey?: string;
  showDistributions: boolean;
  onDistributionError: () => void;
  onFetchingDistributionChange: (isFetching: boolean) => void;
}) => {
  const [search, setSearch] = useState('');
  // "Show More" button when there's lots of options
  const [shouldShowMore, setShowMore] = useState(false);
  // Track recently moved items for highlight animation
  const [recentlyMoved, setRecentlyMoved] = useState<Set<string | boolean>>(
    new Set(),
  );
  // For live searches, don't refresh percentages when date range changes
  const [dateRange, setDateRange] = useState<[Date, Date]>(
    chartConfig.dateRange,
  );

  useEffect(() => {
    if (!isLive) {
      setDateRange(chartConfig.dateRange);
    }
  }, [chartConfig.dateRange, isLive]);

  const handleSetSearch = useCallback(
    (value: string) => {
      setSearch(value);
      if (value && !hasLoadedMore) {
        onLoadMore(name);
      }
    },
    [hasLoadedMore, name, onLoadMore],
  );

  const {
    data: distributionData,
    isFetching: isFetchingDistribution,
    error: distributionError,
  } = useGetValuesDistribution(
    {
      chartConfig: { ...chartConfig, dateRange },
      key: distributionKey || name,
      limit: 100, // The 100 most common values are enough to find any values that are present in at least 1% of rows
    },
    {
      enabled: showDistributions,
    },
  );

  useEffect(() => {
    onFetchingDistributionChange(isFetchingDistribution);
  }, [isFetchingDistribution, onFetchingDistributionChange]);

  useEffect(() => {
    if (distributionError) {
      notifications.show({
        color: 'red',
        title: 'Error loading filter distribution',
        message: distributionError?.message,
        autoClose: 5000,
      });
      onDistributionError();
    }
  }, [distributionError, onDistributionError]);

  const totalAppliedFiltersSize =
    selectedValues.included.size +
    selectedValues.excluded.size +
    (selectedValues.range != null ? 1 : 0);

  // Loaded options + any selected options that aren't in the loaded list
  const augmentedOptions = useMemo(() => {
    const selectedSet = new Set([
      ...selectedValues.included,
      ...selectedValues.excluded,
    ]);
    return [
      ...Array.from(selectedSet)
        .filter(value => !options.find(option => option.value === value))
        .map(value => ({ value, label: value.toString() })),
      ...options,
    ];
  }, [options, selectedValues]);

  const displayedItemLimit = shouldShowMore
    ? SHOW_MORE_MAX_VALUES_DISPLAYED
    : INITIAL_MAX_VALUES_DISPLAYED;

  // Options matching search, sorted appropriately
  const sortedMatchingOptions = useMemo(() => {
    // When searching, sort alphabetically
    if (search) {
      return augmentedOptions
        .filter(option => {
          return (
            option.value &&
            option.label.toLowerCase().includes(search.toLowerCase())
          );
        })
        .toSorted((a, b) =>
          a.label.localeCompare(b.label, undefined, { numeric: true }),
        );
    }

    // When not searching, sort by personal pinned, shared pinned, selected,
    // distribution, then alphabetically
    return augmentedOptions.toSorted((a, b) => {
      const aPinned = isPinned(a.value);
      const aShared = isSharedPinned?.(a.value) ?? false;
      const aIncluded = selectedValues.included.has(a.value);
      const aExcluded = selectedValues.excluded.has(a.value);
      const bPinned = isPinned(b.value);
      const bShared = isSharedPinned?.(b.value) ?? false;
      const bIncluded = selectedValues.included.has(b.value);
      const bExcluded = selectedValues.excluded.has(b.value);

      // First sort by personal pinned status
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;

      // Then sort by shared pinned status
      if (aShared && !bShared) return -1;
      if (!aShared && bShared) return 1;

      // Then sort by included status
      if (aIncluded && !bIncluded) return -1;
      if (!aIncluded && bIncluded) return 1;

      // Then sort by excluded status
      if (aExcluded && !bExcluded) return -1;
      if (!aExcluded && bExcluded) return 1;

      // Then sort by estimated percentage of rows with this value, if available
      const aPercentage = distributionData?.get(a.value.toString()) ?? 0;
      const bPercentage = distributionData?.get(b.value.toString()) ?? 0;
      if (aPercentage !== bPercentage) {
        return bPercentage - aPercentage;
      }

      // Finally sort alphabetically/numerically
      return a.label.localeCompare(b.label, undefined, { numeric: true });
    });
  }, [
    search,
    augmentedOptions,
    isPinned,
    isSharedPinned,
    selectedValues.included,
    selectedValues.excluded,
    distributionData,
  ]);

  // The subset of options to be displayed
  const displayedOptions = useMemo(() => {
    return sortedMatchingOptions.length <= displayedItemLimit
      ? sortedMatchingOptions
      : sortedMatchingOptions.slice(0, displayedItemLimit);
  }, [sortedMatchingOptions, displayedItemLimit]);

  // Simple highlight animation when checkbox is checked
  const handleChange = useCallback(
    (value: string | boolean) => {
      // If checking (not unchecking), trigger highlight animation
      const wasIncluded = selectedValues.included.has(value);
      if (!wasIncluded) {
        setRecentlyMoved(prev => new Set(prev).add(value));
        setTimeout(() => {
          setRecentlyMoved(prev => {
            const newSet = new Set(prev);
            newSet.delete(value);
            return newSet;
          });
        }, 600);
      }
      onChange(value);
    },
    [onChange, selectedValues],
  );

  const isLimitingDisplayedItems =
    sortedMatchingOptions.length > displayedOptions.length;

  const showShowMoreButton =
    !search &&
    augmentedOptions.length > INITIAL_MAX_VALUES_DISPLAYED &&
    totalAppliedFiltersSize < augmentedOptions.length;

  return (
    <Stack gap={0}>
      {augmentedOptions.length > 5 && (
        <div className="px-2 pb-2">
          <TextInput
            size="xs"
            placeholder="Search values..."
            value={search}
            data-testid={`filter-search-${name}`}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              handleSetSearch(event.currentTarget.value)
            }
            rightSectionWidth={20}
            rightSection={<IconSearch size={12} stroke={2} />}
            classNames={{
              input: 'ps-0.5',
            }}
          />
        </div>
      )}
      {displayedOptions.map(option => (
        <FilterCheckbox
          key={option.value.toString()}
          columnName={name}
          label={option.label}
          pinned={isPinned(option.value)}
          className={
            recentlyMoved.has(option.value) ? classes.recentlyMoved : ''
          }
          value={
            selectedValues.included.has(option.value)
              ? 'included'
              : selectedValues.excluded.has(option.value)
                ? 'excluded'
                : false
          }
          onChange={() => handleChange(option.value)}
          onClickOnly={() => onOnlyClick(option.value)}
          onClickExclude={() => onExcludeClick(option.value)}
          onClickPin={() => onPinClick(option.value)}
          sharedPinned={isSharedPinned?.(option.value)}
          onClickSharedPin={
            onSharedPinClick ? () => onSharedPinClick(option.value) : undefined
          }
          isPercentageLoading={isFetchingDistribution}
          percentage={
            showDistributions && distributionData
              ? (distributionData.get(option.value.toString()) ?? 0)
              : undefined
          }
        />
      ))}
      {optionsLoading ? (
        <Group m={6} gap="xs">
          <Loader size={12} color="gray" />
          <Text c="dimmed" size="xs">
            Loading...
          </Text>
        </Group>
      ) : displayedOptions.length === 0 ? (
        <Group m={6} gap="xs">
          <Text c="dimmed" size="xs">
            No options found
          </Text>
        </Group>
      ) : null}
      {isLimitingDisplayedItems && (shouldShowMore || search) && (
        <Text size="xxs" ms={28} fs="italic">
          Search to see more
        </Text>
      )}
      {loadMoreLoading && (
        <Group m={6} gap="xs">
          <Loader size={12} color="gray" />
          <Text c="dimmed" size="xs">
            Loading more...
          </Text>
        </Group>
      )}
      {showShowMoreButton && (
        <div className="d-flex m-1">
          <TextButton
            data-testid={`filter-show-more-${name}`}
            label={
              shouldShowMore ? (
                <>
                  <IconChevronUp size={12} /> Less
                </>
              ) : (
                <>
                  <IconChevronRight size={12} /> Show more
                </>
              )
            }
            onClick={() => {
              // When show more is clicked, immediately show all and also fetch more from server.
              setShowMore(!shouldShowMore);
              if (!shouldShowMore) {
                onLoadMore?.(name);
              }
            }}
          />
        </div>
      )}
      {onLoadMore &&
        !showShowMoreButton &&
        !shouldShowMore &&
        !hasLoadedMore &&
        !loadMoreLoading && (
          <div className="d-flex m-1">
            <TextButton
              data-testid={`filter-load-more-${name}`}
              display={hasLoadedMore ? 'none' : undefined}
              label={
                <>
                  <IconChevronRight size={12} /> Load more
                </>
              }
              onClick={() => onLoadMore(name)}
            />
          </div>
        )}
    </Stack>
  );
};

type FilterGroupActionsProps = {
  name: string;
  hasRange: boolean;
  showDistributions: boolean;
  isFetchingDistribution: boolean;
  isColumnDisplayed: boolean;
  isFieldPinned: boolean;
  isSharedFieldPinned: boolean;
  totalAppliedFiltersSize: number;
  toggleShowDistributions: VoidFunction;
  onColumnToggle?: VoidFunction;
  onFieldPinClick: VoidFunction;
  onToggleSharedFieldPin: VoidFunction;
  onClearClick: VoidFunction;
};
function FilterGroupActions({
  name,
  hasRange,
  showDistributions,
  isFetchingDistribution,
  isColumnDisplayed,
  isFieldPinned,
  isSharedFieldPinned,
  totalAppliedFiltersSize,
  toggleShowDistributions,
  onColumnToggle,
  onFieldPinClick,
  onToggleSharedFieldPin,
  onClearClick,
}: FilterGroupActionsProps) {
  return (
    <Group gap={0} wrap="nowrap">
      {!hasRange && (
        <>
          <Tooltip
            label={
              showDistributions ? 'Hide Distribution' : 'Show Distribution'
            }
            position="top"
            withArrow
            fz="xxs"
            color="gray"
          >
            <ActionIcon
              size="xs"
              variant="subtle"
              color="gray"
              onClick={toggleShowDistributions}
              data-testid={`toggle-distribution-button-${name}`}
              aria-checked={showDistributions}
              role="checkbox"
            >
              {isFetchingDistribution ? (
                <Center>
                  <IconRefresh className="spin-animate" size={12} />
                </Center>
              ) : showDistributions ? (
                <IconChartBarOff size={14} />
              ) : (
                <IconChartBar size={14} />
              )}
            </ActionIcon>
          </Tooltip>
          {onColumnToggle && (
            <Tooltip
              label={isColumnDisplayed ? 'Remove Column' : 'Add Column'}
              position="top"
              withArrow
              fz="xxs"
              color="gray"
            >
              <ActionIcon
                size="xs"
                variant="subtle"
                color="gray"
                onClick={onColumnToggle}
                data-testid={`toggle-column-button-${name}`}
              >
                {isColumnDisplayed ? (
                  <IconMinus size={14} />
                ) : (
                  <IconPlus size={14} />
                )}
              </ActionIcon>
            </Tooltip>
          )}
          <PinShareMenu
            personalPinned={isFieldPinned}
            sharedPinned={isSharedFieldPinned}
            onTogglePersonalPin={onFieldPinClick}
            onToggleSharedPin={onToggleSharedFieldPin}
          />
        </>
      )}
      {totalAppliedFiltersSize > 0 && (
        <Tooltip
          label="Clear Filters"
          position="top"
          withArrow
          fz="xxs"
          color="gray"
        >
          <ActionIcon
            size="xs"
            variant="subtle"
            color="gray"
            onClick={onClearClick}
          >
            <IconFilterOff size={14} />
          </ActionIcon>
        </Tooltip>
      )}
    </Group>
  );
}

const voidFunc = () => {};

export const FilterGroup = ({
  name,
  options,
  optionsLoading,
  selectedValues: _selectedValues,
  onChange,
  onClearClick,
  onOnlyClick,
  onExcludeClick,
  valuePins,
  fieldPins,
  onColumnToggle,
  isColumnDisplayed,
  onLoadMore,
  loadMoreLoading,
  hasLoadedMore,
  isDefaultExpanded,
  showFilterCounts,
  'data-testid': dataTestId,
  chartConfig,
  isLive,
  distributionKey,
  onRangeChange,
}: FilterGroupProps) => {
  const [isExpanded, setExpanded] = useState(isDefaultExpanded ?? false);
  const [showDistributions, setShowDistributions] = useState(false);
  const [isFetchingDistribution, setIsFetchingDistribution] = useState(false);

  const selectedValues: SelectedValues = useMemo(
    () => _selectedValues ?? { included: new Set(), excluded: new Set() },
    [_selectedValues],
  );

  const hasRange = selectedValues.range != null;

  const toggleShowDistributions = useCallback(() => {
    setShowDistributions(prev => {
      if (!prev) {
        setExpanded(true);
      }
      return !prev;
    });
  }, []);

  const onDistributionError = useCallback(() => {
    setShowDistributions(false);
  }, []);

  useEffect(() => {
    if (isDefaultExpanded) {
      setExpanded(true);
    }
  }, [isDefaultExpanded]);

  const totalAppliedFiltersSize =
    selectedValues.included.size +
    selectedValues.excluded.size +
    (hasRange ? 1 : 0);

  const hasOptions = options.length > 0 || totalAppliedFiltersSize > 0;

  return (
    <Accordion
      variant="unstyled"
      chevronPosition="left"
      classNames={{ chevron: classes.chevron }}
      value={isExpanded ? name : null}
      onChange={v => {
        setExpanded(v === name);
      }}
    >
      <Accordion.Item value={name} data-testid={dataTestId}>
        <Stack gap={0}>
          <Center>
            <Accordion.Control
              component={UnstyledButton}
              flex="1"
              p="0"
              pr="xxxs"
              data-testid="filter-group-control"
              style={{ overflow: 'hidden' }}
              classNames={{
                chevron: 'm-0',
                label: 'p-0',
              }}
              className={hasOptions ? '' : 'opacity-50'}
            >
              <Tooltip
                openDelay={name.length > 26 ? 0 : 1500}
                label={name}
                position="top"
                withArrow
                fz="xxs"
                color="gray"
              >
                <Text size="xs" fw="500" truncate="end">
                  {name}
                  {showFilterCounts && (
                    <Text
                      component="span"
                      size="xs"
                      c="dimmed"
                    >{` (${totalAppliedFiltersSize})`}</Text>
                  )}
                </Text>
              </Tooltip>
            </Accordion.Control>
            <FilterGroupActions
              name={name}
              hasRange={hasRange}
              showDistributions={showDistributions}
              isFetchingDistribution={isFetchingDistribution}
              isColumnDisplayed={isColumnDisplayed ?? false}
              isFieldPinned={fieldPins?.isFieldPinned ?? false}
              isSharedFieldPinned={fieldPins?.isSharedFieldPinned ?? false}
              toggleShowDistributions={toggleShowDistributions}
              onColumnToggle={onColumnToggle}
              onFieldPinClick={fieldPins?.onFieldPinClick ?? voidFunc}
              onToggleSharedFieldPin={
                fieldPins?.onToggleSharedFieldPin ?? voidFunc
              }
              totalAppliedFiltersSize={totalAppliedFiltersSize}
              onClearClick={onClearClick}
            />
          </Center>
          <Accordion.Panel
            data-testid="filter-group-panel"
            classNames={{
              content: 'p-0 pt-2',
            }}
          >
            {hasRange && selectedValues.range ? (
              <FilterRangeDisplay
                name={name}
                range={selectedValues.range}
                onClearClick={onClearClick}
                onRangeChange={onRangeChange}
              />
            ) : (
              isExpanded && (
                <FilterGroupBody
                  name={name}
                  options={options}
                  optionsLoading={optionsLoading}
                  selectedValues={selectedValues}
                  onChange={onChange}
                  onOnlyClick={onOnlyClick}
                  onExcludeClick={onExcludeClick}
                  isPinned={valuePins.isPinned}
                  onPinClick={valuePins.onPinClick}
                  isSharedPinned={valuePins.isSharedPinned}
                  onSharedPinClick={valuePins.onSharedPinClick}
                  onLoadMore={onLoadMore}
                  loadMoreLoading={loadMoreLoading}
                  hasLoadedMore={hasLoadedMore}
                  chartConfig={chartConfig}
                  isLive={isLive}
                  distributionKey={distributionKey}
                  showDistributions={showDistributions}
                  onDistributionError={onDistributionError}
                  onFetchingDistributionChange={setIsFetchingDistribution}
                />
              )
            )}
          </Accordion.Panel>
        </Stack>
      </Accordion.Item>
    </Accordion>
  );
};

const DBSearchPageFiltersComponent = ({
  filters: filterState,
  clearAllFilters,
  clearFilter,
  setFilterValue: _setFilterValue,
  isLive,
  chartConfig,
  analysisMode,
  setAnalysisMode,
  sourceId,
  showDelta,
  denoiseResults,
  setDenoiseResults,
  setFilterRange,
  onColumnToggle,
  displayedColumns,
  onCollapse,
}: {
  analysisMode: 'results' | 'delta' | 'pattern';
  setAnalysisMode: (mode: 'results' | 'delta' | 'pattern') => void;
  isLive: boolean;
  chartConfig: BuilderChartConfigWithDateRange;
  sourceId?: string;
  showDelta: boolean;
  denoiseResults: boolean;
  setDenoiseResults: (denoiseResults: boolean) => void;
  setFilterRange: (key: string, range: { min: number; max: number }) => void;
  onColumnToggle?: (column: string) => void;
  displayedColumns?: string[];
  onCollapse?: () => void;
} & FilterStateHook) => {
  const setFilterValue = useCallback(
    (
      property: string,
      value: string | boolean,
      action?: 'only' | 'exclude' | 'include' | undefined,
    ) => {
      return _setFilterValue(property, value, action);
    },
    [_setFilterValue],
  );
  const {
    toggleFilterPin,
    toggleFieldPin,
    isFilterPinned,
    isFieldPinned,
    getPinnedFields,
    pinnedFilters,
    toggleSharedFieldPin,
    isSharedFieldPinned,
    toggleSharedFilterPin,
    isSharedFilterPinned,
    resetPersonalPins,
    resetSharedFilters,
    hasPersonalPins,
    hasSharedPins,
  } = usePinnedFilters(sourceId ?? null);
  const { data: pinnedFiltersApiData } = usePinnedFiltersApi(sourceId ?? null);
  const [isSharedFiltersVisible, setSharedFiltersVisible] = useLocalStorage(
    'hdx-shared-filters-visible',
    true,
  );
  const [showFilterCounts, setShowFilterCounts] = useLocalStorage(
    'hdx-show-filter-counts',
    true,
  );
  const { size, startResize } = useResizable(16, 'left');

  const { data: jsonColumns } = useJsonColumns({
    databaseName: chartConfig.from.databaseName,
    tableName: chartConfig.from.tableName,
    connectionId: chartConfig.connection,
  });
  const { data, isLoading, error } = useAllFields({
    databaseName: chartConfig.from.databaseName,
    tableName: chartConfig.from.tableName,
    connectionId: chartConfig.connection,
  });
  const { data: columns } = useColumns({
    databaseName: chartConfig.from.databaseName,
    tableName: chartConfig.from.tableName,
    connectionId: chartConfig.connection,
  });

  const { data: source } = useSource({ id: sourceId });
  const { data: tableMetadata } = useTableMetadata(tcFromSource(source));

  useEffect(() => {
    if (error) {
      notifications.show({
        color: 'red',
        title: error?.name,
        message: error?.message,
        autoClose: 5000,
      });
    }
  }, [error]);

  const [showMoreFields, setShowMoreFields] = useState(false);

  const keysToFetch = useMemo(() => {
    if (!data) {
      return [];
    }

    const strings = data
      .sort((a, b) => {
        // First show low cardinality fields
        const isLowCardinality = (type: string) =>
          type.includes('LowCardinality');
        return isLowCardinality(a.type) && !isLowCardinality(b.type) ? -1 : 1;
      })
      .filter(
        field => field.jsType && ['string'].includes(field.jsType),
        // todo: add number type with sliders :D
      )
      .map(({ path, type }) => {
        return {
          type,
          path: mergePath(path, jsonColumns ?? []),
          isMapSubField: path.length > 1,
        };
      })
      .filter(
        field =>
          showMoreFields ||
          field.type.includes('LowCardinality') || // query only low cardinality fields by default
          field.isMapSubField || // always include Map/JSON sub-fields (e.g. LogAttributes, ResourceAttributes keys)
          Object.keys(filterState).includes(field.path) || // keep selected fields
          isFieldPinned(field.path), // keep pinned fields
      )
      .map(({ path }) => path)
      .filter(
        path =>
          !['body', 'timestamp', '_hdx_body'].includes(path.toLowerCase()),
      );
    return strings;
  }, [data, jsonColumns, filterState, showMoreFields, isFieldPinned]);

  // Special case for live tail
  const [dateRange, setDateRange] = useState<[Date, Date]>(
    chartConfig.dateRange,
  );

  useEffect(() => {
    if (!isLive) {
      setDateRange(chartConfig.dateRange);
      setExtraFacets({});
    }
  }, [chartConfig.dateRange, isLive]);

  // Clear extra facets (from "load more") when switching sources
  useEffect(() => {
    setExtraFacets({});
  }, [sourceId]);

  const showRefreshButton = isLive && dateRange !== chartConfig.dateRange;

  const {
    data: facets,
    isLoading: isFacetsLoading,
    isFetching: isFacetsFetching,
  } = useGetKeyValues({
    chartConfig: { ...chartConfig, dateRange },
    limit: INITIAL_LOAD_LIMIT,
    keys: keysToFetch,
  });

  // Merge pinned filter values into the queried facets, so that pinned values are always available
  const facetsWithPinnedValues = useMemo(() => {
    const facetsMap = new Map((facets ?? []).map(f => [f.key, f.value]));
    const mergedKeys = new Set<string>([
      ...facetsMap.keys(),
      ...Object.keys(pinnedFilters),
      ...getPinnedFields(),
    ]);

    return Array.from(mergedKeys).map(key => {
      const queriedValues = facetsMap.get(key);
      const pinnedValues = pinnedFilters[key];
      const mergedValues = new Set<string | boolean>([
        ...(queriedValues ?? []),
        ...(pinnedValues ?? []),
      ]);

      return { key, value: Array.from(mergedValues) };
    });
  }, [facets, pinnedFilters, getPinnedFields]);

  const metadata = useMetadataWithSettings();
  const [extraFacets, setExtraFacets] = useState<Record<string, string[]>>({});
  const [loadMoreLoadingKeys, setLoadMoreLoadingKeys] = useState<Set<string>>(
    new Set(),
  );
  const loadMoreFilterValuesForKey = useCallback(
    async (key: string) => {
      setLoadMoreLoadingKeys(prev => new Set(prev).add(key));
      try {
        const newKeyVals = await metadata.getKeyValuesWithMVs({
          chartConfig: {
            ...chartConfig,
            dateRange,
          },
          keys: [key],
          limit: LOAD_MORE_LOAD_LIMIT,
          disableRowLimit: true,
          source,
        });
        const newValues = newKeyVals[0].value?.map(val => val.toString()) ?? [];
        if (newValues.length > 0) {
          setExtraFacets(prev => ({
            ...prev,
            [key]: [...(prev[key] || []), ...newValues],
          }));
        }
      } catch (error) {
        console.error('failed to fetch more keys', error);
      } finally {
        setLoadMoreLoadingKeys(prev => {
          const newSet = new Set(prev);
          newSet.delete(key);
          return newSet;
        });
      }
    },
    [chartConfig, setExtraFacets, dateRange, metadata, source],
  );

  // Build the set of team-pinned fields for the Shared Filters section,
  // so we can avoid duplicating them in the regular Filters list below.
  const sharedFilterKeys = useMemo(() => {
    if (!isSharedFiltersVisible || !pinnedFiltersApiData?.team) {
      return new Set<string>();
    }
    const team = pinnedFiltersApiData.team;
    return new Set([...team.fields, ...Object.keys(team.filters)]);
  }, [isSharedFiltersVisible, pinnedFiltersApiData]);

  // Build the facet list for the Shared Filters section.
  // For each team-pinned field: merge pinned values with dynamic facet values.
  const sharedFacets = useMemo(() => {
    if (sharedFilterKeys.size === 0) return [];

    const facetMap = new Map(
      (facetsWithPinnedValues ?? []).map(f => [f.key, f.value]),
    );

    return Array.from(sharedFilterKeys).map(key => {
      const teamVals = pinnedFiltersApiData?.team?.filters[key] ?? [];
      const dynamicValues = facetMap.get(key) ?? [];

      if (teamVals.length > 0) {
        const merged = [...teamVals];
        for (const v of dynamicValues) {
          if (!merged.some(existing => existing === v)) {
            merged.push(v);
          }
        }
        return { key, value: merged };
      }
      // Field-only pin — show dynamic values
      return { key, value: dynamicValues };
    });
  }, [sharedFilterKeys, facetsWithPinnedValues, pinnedFiltersApiData]);

  const shownFacets = useMemo(() => {
    const _facets: { key: string; value: (string | boolean)[] }[] = [];
    for (const _facet of facetsWithPinnedValues ?? []) {
      const facet = structuredClone(_facet);
      if (jsonColumns?.some(col => facet.key.startsWith(col))) {
        facet.key = `toString(${facet.key})`;
      }

      // Skip fields already shown in the Shared Filters section
      if (sharedFilterKeys.has(facet.key)) {
        continue;
      }

      // don't include empty facets, unless they are already selected or pinned
      const filter = filterState[facet.key];
      const hasSelectedValues =
        filter && (filter.included.size > 0 || filter.excluded.size > 0);
      const isPinned = isFieldPinned(facet.key);
      if (facet.value?.length > 0 || hasSelectedValues || isPinned) {
        const extraValues = extraFacets[facet.key];
        if (extraValues && extraValues.length > 0) {
          const allValues = facet.value.slice();
          for (const extraValue of extraValues) {
            if (!allValues.includes(extraValue)) {
              allValues.push(extraValue);
            }
          }
          _facets.push({
            key: facet.key,
            value: allValues,
          });
        } else {
          _facets.push(facet);
        }
      }
    }
    // get remaining filterState that are not in _facets
    const remainingFilterState = Object.keys(filterState).filter(
      key =>
        !_facets.some(facet => facet.key === key) && !sharedFilterKeys.has(key),
    );
    for (const key of remainingFilterState) {
      _facets.push({
        key,
        value: Array.from(filterState[key].included),
      });
    }

    // prioritize facets that are primary keys
    _facets.sort((a, b) => {
      const aIsPk = isFieldPrimary(tableMetadata, a.key);
      const bIsPk = isFieldPrimary(tableMetadata, b.key);
      return aIsPk && !bIsPk ? -1 : bIsPk && !aIsPk ? 1 : 0;
    });

    // prioritize facets that are pinned (either personal or shared)
    _facets.sort((a, b) => {
      const aPinned = isFieldPinned(a.key) || isSharedFieldPinned(a.key);
      const bPinned = isFieldPinned(b.key) || isSharedFieldPinned(b.key);
      return aPinned && !bPinned ? -1 : bPinned && !aPinned ? 1 : 0;
    });

    // among pinned, prioritize shared over personal
    _facets.sort((a, b) => {
      const aShared = isSharedFieldPinned(a.key);
      const bShared = isSharedFieldPinned(b.key);
      return aShared && !bShared ? -1 : bShared && !aShared ? 1 : 0;
    });

    // prioritize facets that have checked items
    _facets.sort((a, b) => {
      const aChecked = filterState?.[a.key]?.included.size > 0;
      const bChecked = filterState?.[b.key]?.included.size > 0;
      return aChecked && !bChecked ? -1 : bChecked && !aChecked ? 1 : 0;
    });

    // prioritize facets that have a range
    _facets.sort((a, b) => {
      const aRange = filterState?.[a.key]?.range;
      const bRange = filterState?.[b.key]?.range;
      if (aRange && !bRange) return -1;
      if (!aRange && bRange) return 1;
      return 0;
    });

    return _facets;
  }, [
    facetsWithPinnedValues,
    filterState,
    tableMetadata,
    extraFacets,
    isFieldPinned,
    isSharedFieldPinned,
    jsonColumns,
    sharedFilterKeys,
  ]);

  // Check if shared facets have active selections
  const showSharedClearButton = useMemo(
    () =>
      sharedFacets.some(facet => {
        const f = filterState[facet.key];
        return (
          f && (f.included.size > 0 || f.excluded.size > 0 || f.range != null)
        );
      }),
    [sharedFacets, filterState],
  );

  // Check if non-shared facets have active selections
  const showFiltersClearButton = useMemo(
    () =>
      shownFacets.some(facet => {
        const f = filterState[facet.key];
        return (
          f && (f.included.size > 0 || f.excluded.size > 0 || f.range != null)
        );
      }),
    [shownFacets, filterState],
  );

  const clearSharedSelections = useCallback(() => {
    for (const facet of sharedFacets) {
      clearFilter(facet.key);
    }
  }, [sharedFacets, clearFilter]);

  const clearRegularSelections = useCallback(() => {
    for (const facet of shownFacets) {
      clearFilter(facet.key);
    }
  }, [shownFacets, clearFilter]);

  const parentSpanIdExpr =
    source?.kind === SourceKind.Trace
      ? source.parentSpanIdExpression
      : undefined;

  const setRootSpansOnly = useCallback(
    (rootSpansOnly: boolean) => {
      if (!parentSpanIdExpr) return;

      if (rootSpansOnly) {
        if (columns?.some(col => col.name === IS_ROOT_SPAN_COLUMN_NAME)) {
          setFilterValue(IS_ROOT_SPAN_COLUMN_NAME, true, 'only');
        } else {
          setFilterValue(parentSpanIdExpr, '', 'only');
        }
      } else {
        clearFilter(parentSpanIdExpr);
        clearFilter(IS_ROOT_SPAN_COLUMN_NAME);
      }
    },
    [setFilterValue, clearFilter, parentSpanIdExpr, columns],
  );

  const isRootSpansOnly = useMemo(() => {
    if (!parentSpanIdExpr || source?.kind !== SourceKind.Trace) return false;

    const parentSpanIdFilter = filterState?.[parentSpanIdExpr];
    const isRootSpanFilter = filterState?.[IS_ROOT_SPAN_COLUMN_NAME];
    return (
      (parentSpanIdFilter?.included.size === 1 &&
        parentSpanIdFilter?.included.has('')) ||
      (isRootSpanFilter?.included.size === 1 &&
        isRootSpanFilter?.included.has(true))
    );
  }, [filterState, source, parentSpanIdExpr]);

  /**
   * Renders a list of facets as FilterGroup and NestedFilterGroup components.
   * Used for both the Shared Filters section and the regular Filters section.
   */
  const renderFacetList = useCallback(
    (
      facets: { key: string; value: (string | boolean)[] }[],
      options?: { keyPrefix?: string; isDefaultExpanded?: boolean },
    ) => {
      const { keyPrefix = '', isDefaultExpanded: forceExpanded } =
        options ?? {};
      const { grouped, nonGrouped } = groupFacetsByBaseName(facets);

      const makeValuePins = (key: string): ValuePinHandlers => ({
        onPinClick: (value: string | boolean) => toggleFilterPin(key, value),
        isPinned: (value: string | boolean) => isFilterPinned(key, value),
        onSharedPinClick: (value: string | boolean) =>
          toggleSharedFilterPin(key, value),
        isSharedPinned: (value: string | boolean) =>
          isSharedFilterPinned(key, value),
      });

      const makeFieldPins = (key: string): FieldPinHandlers => ({
        onFieldPinClick: () => toggleFieldPin(key),
        isFieldPinned: isFieldPinned(key),
        onToggleSharedFieldPin: () => toggleSharedFieldPin(key),
        isSharedFieldPinned: isSharedFieldPinned(key),
      });

      return (
        <>
          {grouped.map(group => (
            <NestedFilterGroup
              key={`${keyPrefix}${group.key}`}
              data-testid={`${keyPrefix}nested-filter-group-${group.key}`}
              name={group.key}
              childFilters={group.children}
              selectedValues={group.children.reduce((acc, child) => {
                acc[child.key] = filterState[child.key] ?? {
                  included: new Set(),
                  excluded: new Set(),
                };
                return acc;
              }, {} as FilterState)}
              onChange={(key, value) => setFilterValue(key, value)}
              onClearClick={key => clearFilter(key)}
              onOnlyClick={(key, value) => setFilterValue(key, value, 'only')}
              onExcludeClick={(key, value) =>
                setFilterValue(key, value, 'exclude')
              }
              onPinClick={(key, value) => toggleFilterPin(key, value)}
              isPinned={(key, value) => isFilterPinned(key, value)}
              onSharedPinClick={(key, value) =>
                toggleSharedFilterPin(key, value)
              }
              isSharedPinned={(key, value) => isSharedFilterPinned(key, value)}
              onFieldPinClick={key => toggleFieldPin(key)}
              isFieldPinned={key => isFieldPinned(key)}
              onToggleSharedFieldPin={key => toggleSharedFieldPin(key)}
              isSharedFieldPinned={key => isSharedFieldPinned(key)}
              onColumnToggle={onColumnToggle}
              displayedColumns={displayedColumns}
              onLoadMore={loadMoreFilterValuesForKey}
              loadMoreLoading={group.children.reduce(
                (acc, child) => {
                  acc[child.key] = loadMoreLoadingKeys.has(child.key);
                  return acc;
                },
                {} as Record<string, boolean>,
              )}
              hasLoadedMore={group.children.reduce(
                (acc, child) => {
                  acc[child.key] = Boolean(extraFacets[child.key]);
                  return acc;
                },
                {} as Record<string, boolean>,
              )}
              isDefaultExpanded={
                forceExpanded ??
                group.children.some(
                  child =>
                    (filterState[child.key] &&
                      (filterState[child.key].included.size > 0 ||
                        filterState[child.key].excluded.size > 0)) ||
                    isFieldPinned(child.key) ||
                    isSharedFieldPinned(child.key),
                )
              }
              chartConfig={chartConfig}
              isLive={isLive}
            />
          ))}
          {nonGrouped.map(facet => (
            <FilterGroup
              key={`${keyPrefix}${facet.key}`}
              data-testid={`${keyPrefix}filter-group-${facet.key}`}
              name={cleanedFacetName(facet.key)}
              showFilterCounts={showFilterCounts}
              options={facet.value.map(value => ({
                value,
                label: value.toString(),
              }))}
              optionsLoading={isFacetsLoading}
              selectedValues={
                filterState[facet.key] ?? {
                  included: new Set(),
                  excluded: new Set(),
                }
              }
              onChange={value => setFilterValue(facet.key, value)}
              onClearClick={() => clearFilter(facet.key)}
              onOnlyClick={value => setFilterValue(facet.key, value, 'only')}
              onExcludeClick={value =>
                setFilterValue(facet.key, value, 'exclude')
              }
              valuePins={makeValuePins(facet.key)}
              fieldPins={makeFieldPins(facet.key)}
              onColumnToggle={
                onColumnToggle ? () => onColumnToggle(facet.key) : undefined
              }
              isColumnDisplayed={displayedColumns?.includes(facet.key)}
              onLoadMore={loadMoreFilterValuesForKey}
              loadMoreLoading={loadMoreLoadingKeys.has(facet.key)}
              hasLoadedMore={Boolean(extraFacets[facet.key])}
              isDefaultExpanded={
                forceExpanded ??
                (isFieldPrimary(tableMetadata, facet.key) ||
                  isFieldPinned(facet.key) ||
                  isSharedFieldPinned(facet.key) ||
                  (filterState[facet.key] != null &&
                    (filterState[facet.key].included.size > 0 ||
                      filterState[facet.key].excluded.size > 0 ||
                      filterState[facet.key].range != null)))
              }
              chartConfig={chartConfig}
              isLive={isLive}
              onRangeChange={range => setFilterRange(facet.key, range)}
            />
          ))}
        </>
      );
    },
    [
      filterState,
      setFilterValue,
      clearFilter,
      toggleFilterPin,
      isFilterPinned,
      toggleSharedFilterPin,
      isSharedFilterPinned,
      toggleFieldPin,
      isFieldPinned,
      toggleSharedFieldPin,
      isSharedFieldPinned,
      onColumnToggle,
      displayedColumns,
      loadMoreFilterValuesForKey,
      loadMoreLoadingKeys,
      extraFacets,
      showFilterCounts,
      isFacetsLoading,
      chartConfig,
      isLive,
      setFilterRange,
      tableMetadata,
    ],
  );

  return (
    <Box className={classes.filtersPanel} style={{ width: `${size}%` }}>
      <div className={resizeStyles.resizeHandle} onMouseDown={startResize} />
      <ScrollArea
        h="100%"
        scrollbarSize={4}
        scrollbars="y"
        style={{
          display: 'block',
          width: '100%',
          overflow: 'hidden',
        }}
      >
        <Stack gap="sm" p="xs">
          <Flex align="center" justify="space-between">
            <Text size="xxs" c="dimmed" fw="bold">
              Analysis Mode
            </Text>
            {onCollapse && (
              <Tooltip label="Hide filters" position="bottom">
                <ActionIcon
                  variant="subtle"
                  size="xs"
                  onClick={onCollapse}
                  aria-label="Hide filters"
                >
                  <IconArrowBarToLeft size={14} />
                </ActionIcon>
              </Tooltip>
            )}
          </Flex>
          <Tabs
            value={analysisMode}
            onChange={value =>
              setAnalysisMode(value as 'results' | 'delta' | 'pattern')
            }
            orientation="vertical"
            w="100%"
            placement="right"
          >
            <Tabs.List w="100%">
              <Tabs.Tab value="results" size="xs" h="24px">
                <Text size="xs">Results Table</Text>
              </Tabs.Tab>
              {showDelta && (
                <Tabs.Tab value="delta" size="xs" h="24px">
                  <Text size="xs">Event Deltas</Text>
                </Tabs.Tab>
              )}
              {!IS_CLICKHOUSE_BUILD && (
                <Tabs.Tab value="pattern" size="xs" h="24px">
                  <Text size="xs">Event Patterns</Text>
                </Tabs.Tab>
              )}
            </Tabs.List>
          </Tabs>

          {isSharedFiltersVisible && (
            <SharedFiltersSection
              hasSharedFacets={sharedFacets.length > 0}
              showClearButton={showSharedClearButton}
              onClearSelections={clearSharedSelections}
            >
              {renderFacetList(sharedFacets, {
                keyPrefix: 'shared-',
                isDefaultExpanded: true,
              })}
            </SharedFiltersSection>
          )}

          <Flex align="center" justify="space-between">
            <Flex className={isFacetsFetching ? 'effect-pulse' : ''}>
              <Text size="xxs" c="dimmed" fw="bold">
                Filters {isFacetsFetching && '···'}
              </Text>
              {showRefreshButton && (
                <TextButton
                  label={
                    <IconRefresh
                      size={14}
                      className="ms-1"
                      onClick={() => setDateRange(chartConfig.dateRange)}
                    />
                  }
                />
              )}
            </Flex>
            <Group gap={0}>
              {showFiltersClearButton && (
                <Tooltip
                  label="Clear Filters"
                  position="top"
                  withArrow
                  fz="xxs"
                  color="gray"
                >
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="xs"
                    onClick={clearRegularSelections}
                    aria-label="Clear Filters"
                  >
                    <IconFilterOff size={14} />
                  </ActionIcon>
                </Tooltip>
              )}
              <FilterSettingsPanel
                isSharedFiltersVisible={isSharedFiltersVisible}
                onSharedFiltersVisibilityChange={setSharedFiltersVisible}
                showFilterCounts={showFilterCounts}
                onShowFilterCountsChange={setShowFilterCounts}
                hasPersonalPins={hasPersonalPins}
                onResetPersonalPins={resetPersonalPins}
                hasSharedPins={hasSharedPins}
                onResetSharedFilters={resetSharedFilters}
              />
            </Group>
          </Flex>

          {analysisMode === 'results' && (
            <Checkbox
              size={13 as any}
              checked={denoiseResults}
              ms="6px"
              label={
                <Tooltip
                  openDelay={200}
                  color="gray"
                  position="right"
                  withArrow
                  label="Denoise results will visually remove events matching common event patterns from the results table."
                >
                  <Text size="xs" mt="-2px" component="div">
                    <Group gap={2}>
                      <IconShadow
                        size={14}
                        style={{ display: 'inline', verticalAlign: 'middle' }}
                      />
                      Denoise Results
                    </Group>
                  </Text>
                </Tooltip>
              }
              onChange={() => setDenoiseResults(!denoiseResults)}
            />
          )}

          {source?.kind === SourceKind.Trace &&
            source.parentSpanIdExpression && (
              <Checkbox
                size={13 as any}
                checked={isRootSpansOnly}
                ms="6px"
                label={
                  <Tooltip
                    openDelay={200}
                    color="gray"
                    position="right"
                    withArrow
                    label="Only show root spans (spans with no parent span)."
                  >
                    <Text size="xs" mt="-2px" component="div">
                      <Group gap={2}>
                        <IconSitemap
                          size={14}
                          style={{ display: 'inline', verticalAlign: 'middle' }}
                        />
                        Root Spans Only
                      </Group>
                    </Text>
                  </Tooltip>
                }
                onChange={event => setRootSpansOnly(event.target.checked)}
              />
            )}

          {isLoading || isFacetsLoading ? (
            <Flex align="center" justify="center">
              <Loader size="xs" color="gray" />
            </Flex>
          ) : (
            shownFacets.length === 0 && (
              <Text size="xxs">No filters available</Text>
            )
          )}
          {/* Show facets even when loading to ensure pinned filters are visible while loading */}
          {renderFacetList(shownFacets)}

          <Button
            variant="secondary"
            size="compact-xs"
            loading={isFacetsFetching}
            rightSection={
              showMoreFields ? (
                <IconChevronUp size={14} />
              ) : (
                <IconChevronDown size={14} />
              )
            }
            onClick={() => setShowMoreFields(!showMoreFields)}
          >
            {showMoreFields ? 'Less filters' : 'More filters'}
          </Button>

          {showMoreFields && (
            <div>
              <Text size="xs" fw="bold">
                Not seeing a filter?
              </Text>
              <Text size="xxs">
                {`Try searching instead (e.g. column:foo)`}
              </Text>
            </div>
          )}
        </Stack>
      </ScrollArea>
    </Box>
  );
};

function isFieldPrimary(tableMetadata: TableMetadata | undefined, key: string) {
  return tableMetadata?.primary_key?.includes(key);
}
export const DBSearchPageFilters = memo(DBSearchPageFiltersComponent);
