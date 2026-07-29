import { useCallback, useMemo } from 'react';
import { parseAsString, useQueryState } from 'nuqs';
import { DisplayType, SourceKind } from '@hyperdx/common-utils/dist/types';
import { ActionIcon, Group, Tooltip } from '@mantine/core';
import {
  IconBracketsContain,
  IconChartBar,
  IconChartLine,
  IconChartPie,
  IconChartTreemap,
  IconGrid3x3,
  IconList,
  IconNumbers,
  IconTable,
} from '@tabler/icons-react';

import { IS_CLICKHOUSE_BUILD } from '@/config';

export type SearchView =
  | 'list'
  | 'timeseries'
  | 'number'
  | 'table'
  | 'bar'
  | 'pie'
  | 'treemap'
  | 'heatmap'
  | 'patterns';

const DEFAULT_SEARCH_VIEW: SearchView = 'list';

type SearchViewMeta = {
  value: SearchView;
  label: string;
  icon: React.ReactNode;
  /** Requires an aggregation (agg fn + optional group by). */
  aggregated: boolean;
  /** When set, the view is only offered for these source kinds. */
  sourceKinds?: SourceKind[];
  /** Hidden in the ClickHouse OSS build (matches existing pattern gating). */
  hiddenInClickhouseBuild?: boolean;
};

const SEARCH_VIEWS: SearchViewMeta[] = [
  {
    value: 'list',
    label: 'List',
    icon: <IconList size={16} />,
    aggregated: false,
  },
  {
    value: 'timeseries',
    label: 'Time series',
    icon: <IconChartLine size={16} />,
    aggregated: true,
  },
  {
    value: 'number',
    label: 'Number',
    icon: <IconNumbers size={16} />,
    aggregated: true,
  },
  {
    value: 'table',
    label: 'Grouped table',
    icon: <IconTable size={16} />,
    aggregated: true,
  },
  {
    value: 'bar',
    label: 'Bar',
    icon: <IconChartBar size={16} />,
    aggregated: true,
  },
  {
    value: 'pie',
    label: 'Pie',
    icon: <IconChartPie size={16} />,
    aggregated: true,
  },
  {
    value: 'treemap',
    label: 'Treemap',
    icon: <IconChartTreemap size={16} />,
    aggregated: true,
  },
  {
    value: 'heatmap',
    label: 'Event deltas',
    icon: <IconGrid3x3 size={16} />,
    aggregated: false,
    sourceKinds: [SourceKind.Trace],
  },
  {
    value: 'patterns',
    label: 'Event patterns',
    icon: <IconBracketsContain size={16} />,
    aggregated: false,
    hiddenInClickhouseBuild: true,
  },
];

const VALID_VIEWS = new Set<string>(SEARCH_VIEWS.map(v => v.value));

// Old links / saved searches used mode = results | delta | pattern.
const LEGACY_VIEW_ALIASES: Record<string, SearchView> = {
  results: 'list',
  delta: 'heatmap',
  pattern: 'patterns',
};

function normalizeSearchView(raw: string | null | undefined): SearchView {
  if (raw == null) return DEFAULT_SEARCH_VIEW;
  if (VALID_VIEWS.has(raw)) return raw as SearchView;
  return LEGACY_VIEW_ALIASES[raw] ?? DEFAULT_SEARCH_VIEW;
}

export function isAggregatedSearchView(view: SearchView): boolean {
  return SEARCH_VIEWS.find(v => v.value === view)?.aggregated ?? false;
}

/** Views that keep the top time histogram above the results. */
export function viewShowsHistogram(view: SearchView): boolean {
  return view === 'list' || view === 'patterns';
}

export function searchViewToDisplayType(view: SearchView): DisplayType {
  switch (view) {
    case 'timeseries':
      return DisplayType.StackedBar;
    case 'number':
      return DisplayType.Number;
    case 'table':
      return DisplayType.Table;
    case 'bar':
      return DisplayType.Bar;
    case 'pie':
      return DisplayType.Pie;
    case 'treemap':
      return DisplayType.Treemap;
    default:
      return DisplayType.Search;
  }
}

/** URL-backed search view state, keeping the legacy `mode` param name. */
export function useSearchView(): [SearchView, (view: SearchView) => void] {
  const [raw, setRaw] = useQueryState(
    'mode',
    parseAsString.withDefault(DEFAULT_SEARCH_VIEW),
  );
  const view = useMemo(() => normalizeSearchView(raw), [raw]);
  const setView = useCallback(
    (next: SearchView) => {
      setRaw(next === DEFAULT_SEARCH_VIEW ? null : next);
    },
    [setRaw],
  );
  return [view, setView];
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
    () =>
      SEARCH_VIEWS.filter(v => {
        if (v.hiddenInClickhouseBuild && IS_CLICKHOUSE_BUILD) return false;
        if (
          v.sourceKinds &&
          (!sourceKind || !v.sourceKinds.includes(sourceKind))
        )
          return false;
        // Metric sources have no raw rows, so only aggregated chart views
        // (time series / number / table / bar / pie / treemap) make sense —
        // the List, Event deltas, and Event patterns views are hidden.
        if (sourceKind === SourceKind.Metric && !v.aggregated) return false;
        // SQL mode renders a single raw-SQL statement as a chart display type,
        // so only the aggregated (chart) views apply.
        if (chartTypesOnly && !v.aggregated) return false;
        return true;
      }),
    [sourceKind, chartTypesOnly],
  );

  return (
    <Group
      gap={2}
      wrap="nowrap"
      className="bg-muted px-1 py-1 rounded"
      data-testid="search-view-switcher"
    >
      {options.map(option => (
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
    </Group>
  );
}
