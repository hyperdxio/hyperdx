import { useMemo, useState } from 'react';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import {
  Center,
  Group,
  Menu,
  SegmentedControl,
  Text,
  Tooltip,
  UnstyledButton,
  VisuallyHidden,
} from '@mantine/core';
import { IconChartLine, IconCheck, IconChevronDown } from '@tabler/icons-react';

import {
  DEFAULT_CHART_VIEW,
  getSearchViewMeta,
  getVisibleSearchViews,
  isAggregatedSearchView,
  type SearchView,
} from './searchViews';

import classes from './SearchViewSwitcher.module.scss';

/**
 * Stands in for whichever chart view is current, so the six chart types occupy
 * one segment instead of six. Not a `SearchView`.
 */
const CHART_SEGMENT = 'chart';

/**
 * Only the active segment spends width on its label; the rest stay icon-only
 * with the name in a tooltip, so the row pays for one label rather than one per
 * view.
 */
function segmentLabel(
  label: string,
  icon: React.ReactNode,
  active: boolean,
): React.ReactNode {
  if (active) {
    return (
      <span className={classes.segment}>
        {icon}
        {label}
      </span>
    );
  }
  return (
    <Tooltip label={label} fz="xs" color="gray">
      <Center>
        <VisuallyHidden>{label}</VisuallyHidden>
        {icon}
      </Center>
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

  // Both the chart segment and the As control show the current type's own
  // glyph, so switching type is visible even while the segment is icon-only.
  const chartMeta = getSearchViewMeta(isChart ? value : lastChartView);
  const chartIcon = chartMeta?.icon ?? <IconChartLine size={16} />;

  const segments: { value: string; label: React.ReactNode }[] = eventViews.map(
    option => ({
      value: option.value,
      label: segmentLabel(
        option.shortLabel ?? option.label,
        option.icon,
        value === option.value,
      ),
    }),
  );
  if (chartViews.length > 0) {
    segments.push({
      value: CHART_SEGMENT,
      label: segmentLabel('Charts', chartIcon, isChart),
    });
  }

  return (
    <Group gap="xs" wrap="nowrap" data-testid="search-view-switcher">
      {eventViews.length > 0 && (
        <SegmentedControl
          size="xs"
          withItemsBorders={false}
          classNames={{
            root: classes.switcherRoot,
            label: classes.switcherLabel,
          }}
          value={isChart ? CHART_SEGMENT : value}
          onChange={next => {
            if (next === CHART_SEGMENT) {
              if (!isChart) onChange(lastChartView);
              return;
            }
            const picked = eventViews.find(option => option.value === next);
            if (picked) onChange(picked.value);
          }}
          data={segments}
        />
      )}
      {chartViews.length > 0 && (
        <Menu withinPortal position="bottom-end">
          <div className={classes.asControl}>
            <Text size="xs" fw={500} className={classes.asLabel}>
              As
            </Text>
            <Menu.Target>
              <UnstyledButton
                className={classes.asTarget}
                aria-label={`Chart as ${chartMeta?.label ?? ''}`}
                data-testid="visualize-as-button"
              >
                {chartIcon}
                <Text size="xs" fw={600}>
                  {chartMeta?.label}
                </Text>
                <IconChevronDown size={14} />
              </UnstyledButton>
            </Menu.Target>
          </div>
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
      )}
    </Group>
  );
}
