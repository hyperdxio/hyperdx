import React, { useMemo } from 'react';
import {
  type BuilderChartConfigWithDateRange,
  type ChartConfigWithDateRange,
  DisplayType,
  type TSource,
} from '@hyperdx/common-utils/dist/types';
import { Text, Tooltip } from '@mantine/core';
import {
  IconAlertTriangle,
  IconChartBar,
  IconChartLine,
} from '@tabler/icons-react';

import DateRangeIndicator from '@/components/charts/DateRangeIndicator';
import DisplaySwitcher from '@/components/charts/DisplaySwitcher';
import MVOptimizationIndicator from '@/components/MaterializedViews/MVOptimizationIndicator';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';

type UseChartToolbarItemsArgs = {
  builderQueriedConfig: BuilderChartConfigWithDateRange | undefined;
  config: ChartConfigWithDateRange;
  displayType: DisplayType | undefined;
  exemplarNotice: string | null;
  handleSetDisplayType: (displayType: DisplayType) => void;
  // Derived from the hook rather than hand-copied, so a change to its shape is
  // a type error here instead of a field that quietly stops being read.
  mvOptimizationData: ReturnType<typeof useMVOptimizationExplanation>['data'];
  queriedConfig: ChartConfigWithDateRange;
  showDateRangeIndicator: boolean;
  showDisplaySwitcher: boolean;
  showMVOptimizationIndicator: boolean;
  source: TSource | undefined;
  toolbarPrefix: React.ReactNode[] | undefined;
  toolbarSuffix: React.ReactNode[] | undefined;
};

/**
 * Assemble the chart's toolbar: caller-supplied prefix/suffix items plus the
 * indicators the chart owns (materialized-view optimization, effective date
 * range, exemplar status) and the display-type switcher.
 *
 * Extracted from DBTimeChart because it is a long, purely presentational list
 * build with no bearing on the chart's data or interaction state.
 */
export function useChartToolbarItems({
  builderQueriedConfig,
  config,
  displayType,
  exemplarNotice,
  handleSetDisplayType,
  mvOptimizationData,
  queriedConfig,
  showDateRangeIndicator,
  showDisplaySwitcher,
  showMVOptimizationIndicator,
  source,
  toolbarPrefix,
  toolbarSuffix,
}: UseChartToolbarItemsArgs) {
  return useMemo(() => {
    const allToolbarItems = [];

    if (toolbarPrefix && toolbarPrefix.length > 0) {
      allToolbarItems.push(...toolbarPrefix);
    }

    if (source && showMVOptimizationIndicator && builderQueriedConfig) {
      allToolbarItems.push(
        <MVOptimizationIndicator
          key="db-time-chart-mv-indicator"
          config={builderQueriedConfig}
          source={source}
          variant="icon"
        />,
      );
    }

    const mvDateRange = mvOptimizationData?.optimizedConfig?.dateRange;
    const isAlignedToChartGranularity =
      queriedConfig.alignDateRangeToGranularity !== false;

    if (
      showDateRangeIndicator &&
      (mvDateRange || isAlignedToChartGranularity)
    ) {
      const mvGranularity = isAlignedToChartGranularity
        ? undefined
        : mvOptimizationData?.explanations.find(e => e.success)?.mvConfig
            .minGranularity;

      allToolbarItems.push(
        <DateRangeIndicator
          key="db-time-chart-date-range-indicator"
          originalDateRange={config.dateRange}
          effectiveDateRange={mvDateRange || queriedConfig.dateRange}
          mvGranularity={mvGranularity}
        />,
      );
    }

    if (showDisplaySwitcher) {
      allToolbarItems.push(
        <DisplaySwitcher
          key="db-time-chart-display-switcher"
          value={displayType}
          onChange={handleSetDisplayType}
          options={[
            {
              value: DisplayType.Line,
              label: 'Display as Line Chart',
              icon: <IconChartLine />,
            },
            {
              value: DisplayType.StackedBar,
              label: config.compareToPreviousPeriod
                ? 'Bar Chart Unavailable When Comparing to Previous Period'
                : 'Display as Bar Chart',
              icon: <IconChartBar />,
              disabled: config.compareToPreviousPeriod,
            },
          ]}
        />,
      );
    }

    if (exemplarNotice) {
      allToolbarItems.push(
        <Tooltip
          key="db-time-chart-exemplar-notice"
          label={exemplarNotice}
          withArrow
          multiline
          w={280}
        >
          <Text component="span" c="dimmed" data-testid="exemplar-notice">
            <IconAlertTriangle size={14} />
          </Text>
        </Tooltip>,
      );
    }

    if (toolbarSuffix && toolbarSuffix.length > 0) {
      allToolbarItems.push(...toolbarSuffix);
    }

    return allToolbarItems;
  }, [
    exemplarNotice,
    builderQueriedConfig,
    config,
    displayType,
    handleSetDisplayType,
    showDisplaySwitcher,
    source,
    toolbarPrefix,
    toolbarSuffix,
    showMVOptimizationIndicator,
    showDateRangeIndicator,
    mvOptimizationData,
    queriedConfig,
  ]);
}
