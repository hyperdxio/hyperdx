import { useMemo, useState } from 'react';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Button,
  Divider,
  Group,
  Menu,
  Tooltip,
} from '@mantine/core';
import { IconChartLine, IconCheck, IconChevronDown } from '@tabler/icons-react';

import {
  DEFAULT_CHART_VIEW,
  getSearchViewMeta,
  getVisibleSearchViews,
  isAggregatedSearchView,
  type SearchView,
} from './searchViews';

/** Matches ActionIcon size="md" so the switcher lines up with its neighbours. */
const SEGMENT_HEIGHT = 28;

/**
 * One segment of the switcher. Only the active segment spends width on its
 * label; the rest stay icon-only with the label in a tooltip, so naming the
 * current view costs the row a single label rather than one per view.
 */
function ViewSegment({
  label,
  icon,
  active,
  onClick,
  'data-testid': dataTestId,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  'data-testid'?: string;
}) {
  if (active) {
    return (
      <Button
        variant="primary"
        size="compact-sm"
        h={SEGMENT_HEIGHT}
        px={10}
        leftSection={icon}
        onClick={onClick}
        aria-label={label}
        data-active
        data-testid={dataTestId}
      >
        {label}
      </Button>
    );
  }
  return (
    <Tooltip label={label} fz="xs" color="gray">
      <ActionIcon
        variant="subtle"
        color="gray"
        size="md"
        onClick={onClick}
        aria-label={label}
        data-testid={dataTestId}
      >
        {icon}
      </ActionIcon>
    </Tooltip>
  );
}

export function SearchViewSwitcher({
  value,
  onChange,
  sourceKind,
  chartTypesOnly = false,
}: {
  value: SearchView;
  onChange: (view: SearchView) => void;
  sourceKind?: SourceKind;
  /**
   * When true, only the aggregated chart views are shown. Used by SQL mode,
   * where the switcher picks a raw-SQL display type (the aggregated views map
   * 1:1 to the raw-SQL display types) rather than a builder view.
   */
  chartTypesOnly?: boolean;
}) {
  const options = useMemo(
    () => getVisibleSearchViews({ sourceKind, chartTypesOnly }),
    [sourceKind, chartTypesOnly],
  );
  const eventViews = options.filter(o => !o.aggregated);
  const chartViews = options.filter(o => o.aggregated);
  const isChart = isAggregatedSearchView(value);
  const [lastChartView, setLastChartView] = useState<SearchView>(() =>
    isAggregatedSearchView(value) ? value : DEFAULT_CHART_VIEW,
  );
  if (isAggregatedSearchView(value) && lastChartView !== value) {
    setLastChartView(value);
  }

  // The chart segment wears the chart type's own glyph, so the sibling control
  // is only a chevron and the same icon is never painted twice.
  const chartMeta = getSearchViewMeta(isChart ? value : lastChartView);
  const chartIcon = chartMeta?.icon ?? <IconChartLine size={16} />;

  return (
    <Group
      gap={2}
      wrap="nowrap"
      className="bg-muted px-1 py-1 rounded"
      data-testid="search-view-switcher"
    >
      {eventViews.map(option => (
        <ViewSegment
          key={option.value}
          label={option.shortLabel ?? option.label}
          icon={option.icon}
          active={value === option.value}
          onClick={() => onChange(option.value)}
        />
      ))}
      {eventViews.length > 0 && chartViews.length > 0 && (
        <Divider orientation="vertical" mx={4} my={2} />
      )}
      {chartViews.length > 0 && (
        <>
          <ViewSegment
            label="Chart"
            icon={chartIcon}
            active={isChart}
            onClick={() => {
              if (!isChart) {
                onChange(lastChartView);
              }
            }}
            data-testid="visualize-button"
          />
          <Menu withinPortal position="bottom-end">
            <Tooltip label="Chart as" fz="xs" color="gray">
              <Menu.Target>
                {isChart ? (
                  <Button
                    variant="subtle"
                    color="gray"
                    size="compact-sm"
                    h={SEGMENT_HEIGHT}
                    px={8}
                    rightSection={<IconChevronDown size={14} />}
                    aria-label="Chart as"
                    data-testid="visualize-as-button"
                  >
                    {`as ${chartMeta?.label ?? ''}`}
                  </Button>
                ) : (
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="md"
                    aria-label="Chart as"
                    data-testid="visualize-as-button"
                  >
                    <IconChevronDown size={14} />
                  </ActionIcon>
                )}
              </Menu.Target>
            </Tooltip>
            <Menu.Dropdown>
              {chartViews.map(option => (
                <Menu.Item
                  key={option.value}
                  leftSection={option.icon}
                  rightSection={
                    value === option.value ? <IconCheck size={14} /> : undefined
                  }
                  onClick={() => onChange(option.value)}
                >
                  {option.label}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        </>
      )}
    </Group>
  );
}
