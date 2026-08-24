import { useMemo, useState } from 'react';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { ActionIcon, Divider, Group, Menu, Tooltip } from '@mantine/core';
import { IconChartLine, IconCheck, IconChevronDown } from '@tabler/icons-react';

import {
  DEFAULT_CHART_VIEW,
  getSearchViewMeta,
  getVisibleSearchViews,
  isAggregatedSearchView,
  type SearchView,
} from './searchViews';

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

  // Active chart type lives on Visualize; the sibling control is only a chevron
  // so the same glyph is never painted twice.
  const visualizeIcon = (isChart
    ? getSearchViewMeta(value)?.icon
    : undefined) ??
    getSearchViewMeta(DEFAULT_CHART_VIEW)?.icon ?? <IconChartLine size={16} />;

  return (
    <Group
      gap={2}
      wrap="nowrap"
      className="bg-muted px-1 py-1 rounded"
      data-testid="search-view-switcher"
    >
      {eventViews.map(option => (
        <Tooltip label={option.label} key={option.value} fz="xs" color="gray">
          <ActionIcon
            variant={value === option.value ? 'primary' : 'subtle'}
            color={value === option.value ? undefined : 'gray'}
            size="md"
            onClick={() => onChange(option.value)}
            aria-label={option.label}
            data-active={value === option.value || undefined}
          >
            {option.icon}
          </ActionIcon>
        </Tooltip>
      ))}
      {eventViews.length > 0 && chartViews.length > 0 && (
        <Divider orientation="vertical" mx={4} my={2} />
      )}
      {chartViews.length > 0 && (
        <ActionIcon.Group>
          <Tooltip label="Visualize" fz="xs" color="gray">
            <ActionIcon
              variant={isChart ? 'primary' : 'subtle'}
              color={isChart ? undefined : 'gray'}
              size="md"
              onClick={() => {
                if (!isChart) {
                  onChange(lastChartView);
                }
              }}
              aria-label="Visualize"
              data-testid="visualize-button"
              data-active={isChart || undefined}
            >
              {visualizeIcon}
            </ActionIcon>
          </Tooltip>
          <Menu withinPortal position="bottom-end">
            <Tooltip label="Visualize as" fz="xs" color="gray">
              <Menu.Target>
                <ActionIcon
                  variant={isChart ? 'primary' : 'subtle'}
                  color={isChart ? undefined : 'gray'}
                  size="md"
                  aria-label="Visualize as"
                  data-testid="visualize-as-button"
                >
                  <IconChevronDown size={14} />
                </ActionIcon>
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
        </ActionIcon.Group>
      )}
    </Group>
  );
}
