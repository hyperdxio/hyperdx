import type { FilterState } from '@hyperdx/common-utils/dist/filters';

import type { FilterStateHook } from '@/searchFilters';

export type PillItem = {
  field: string;
  value: string;
  type: 'included' | 'excluded' | 'range';
  rawValue?: string | boolean;
};

export function flattenFilters(filters: FilterState): PillItem[] {
  const pills: PillItem[] = [];
  for (const [field, state] of Object.entries(filters)) {
    for (const val of state.included) {
      pills.push({
        field,
        value: String(val),
        type: 'included',
        rawValue: val,
      });
    }
    for (const val of state.excluded) {
      pills.push({
        field,
        value: String(val),
        type: 'excluded',
        rawValue: val,
      });
    }
    if (state.range != null) {
      pills.push({
        field,
        value: `${state.range.min} – ${state.range.max}`,
        type: 'range',
      });
    }
  }
  return pills;
}

export function removePill(
  pill: PillItem,
  setFilterValue: FilterStateHook['setFilterValue'],
  clearFilter: FilterStateHook['clearFilter'],
): void {
  if (pill.type === 'range') {
    clearFilter(pill.field);
  } else {
    setFilterValue(
      pill.field,
      pill.rawValue!,
      pill.type === 'excluded' ? 'exclude' : undefined,
    );
  }
}
