import { useMemo } from 'react';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { ComboboxItem, OptionsFilter } from '@mantine/core';
import {
  IconChartLine,
  IconConnection,
  IconDeviceLaptop,
  IconLogs,
} from '@tabler/icons-react';

export const SOURCE_KIND_ICONS: Record<string, React.ReactNode> = {
  [SourceKind.Log]: <IconLogs size={16} />,
  [SourceKind.Trace]: <IconConnection size={16} />,
  [SourceKind.Session]: <IconDeviceLaptop size={16} />,
  [SourceKind.Metric]: <IconChartLine size={16} />,
  [SourceKind.Promql]: <IconChartLine size={16} />,
};

/** Header for sources that have no section assigned. Internal to this module. */
const UNSECTIONED_SOURCE_GROUP = 'Other';

export type SourceSelectGroup = { group: string; items: ComboboxItem[] };

export function useSourceKindMap(sources: TSource[] | undefined) {
  return useMemo(() => {
    const map = new Map<string, SourceKind>();
    sources?.forEach(s => map.set(s.id, s.kind));
    return map;
  }, [sources]);
}

const byLabel = (a: ComboboxItem, b: ComboboxItem) =>
  a.label.localeCompare(b.label);

// No per-source ordering field exists yet, so sections render
// alphabetically with the catch-all pinned last. Admin-controlled
// (positional) ordering is the still-open design question.
const bySectionOrder = (a: string, b: string) => {
  if (a === UNSECTIONED_SOURCE_GROUP) return 1;
  if (b === UNSECTIONED_SOURCE_GROUP) return -1;
  return a.localeCompare(b);
};

type FilteredSourceItemsArgs = {
  sources: TSource[] | undefined;
  allowedSourceKinds?: SourceKind[];
  connectionId?: string;
  groupBySection?: boolean;
};

export function useFilteredSortedSourceItems(
  args: FilteredSourceItemsArgs & { groupBySection?: false },
): ComboboxItem[];
export function useFilteredSortedSourceItems(
  args: FilteredSourceItemsArgs & { groupBySection: true },
): SourceSelectGroup[] | ComboboxItem[];
export function useFilteredSortedSourceItems({
  sources,
  allowedSourceKinds,
  connectionId,
  groupBySection = false,
}: FilteredSourceItemsArgs): ComboboxItem[] | SourceSelectGroup[] {
  return useMemo(() => {
    const visible =
      sources?.filter(
        source =>
          (!allowedSourceKinds || allowedSourceKinds.includes(source.kind)) &&
          (!connectionId || source.connection === connectionId) &&
          !source.disabled,
      ) ?? [];

    if (!groupBySection) {
      return visible.map(s => ({ value: s.id, label: s.name })).sort(byLabel);
    }

    const bySection = new Map<string, ComboboxItem[]>();
    for (const source of visible) {
      const section = source.section?.trim() || UNSECTIONED_SOURCE_GROUP;
      const items = bySection.get(section) ?? [];
      items.push({ value: source.id, label: source.name });
      bySection.set(section, items);
    }

    // Stay flat until at least one source has a real section. Otherwise a
    // deployment that has not adopted sections would render a single "Other"
    // header over its whole list, a change from today's flat selector. The
    // grouping switches on the moment someone assigns a section.
    const sectionNames = [...bySection.keys()];
    const hasRealSection = sectionNames.some(
      name => name !== UNSECTIONED_SOURCE_GROUP,
    );
    if (!hasRealSection) {
      return visible.map(s => ({ value: s.id, label: s.name })).sort(byLabel);
    }

    return sectionNames.sort(bySectionOrder).map(group => ({
      group,
      items: (bySection.get(group) ?? []).sort(byLabel),
    }));
  }, [sources, allowedSourceKinds, connectionId, groupBySection]);
}

/**
 * Implicit-tag search for the source selector. A source's match text is its
 * own label plus the section header it sits under, so the section behaves as
 * a tag: "Billing" returns every source under the Billing header, and
 * "Billing Logs" returns the logs in that section, including ones whose name
 * lacks "Billing" (e.g. "Refund Logs"). Tokens are AND-ed and results stay
 * grouped so the matched header explains why each result is there. The signal
 * kind is deliberately not part of the haystack; only name and section match.
 */
export const sourceSelectFilter: OptionsFilter = ({ options, search }) => {
  const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return options;
  }

  const matches = (label: string, groupLabel?: string) =>
    tokens.every(token =>
      `${label} ${groupLabel ?? ''}`.toLowerCase().includes(token),
    );

  const result: typeof options = [];
  for (const option of options) {
    if ('group' in option) {
      const items = option.items.filter(item =>
        matches(item.label, option.group),
      );
      if (items.length > 0) {
        result.push({ ...option, items });
      }
    } else if (matches(option.label)) {
      result.push(option);
    }
  }
  return result;
};
