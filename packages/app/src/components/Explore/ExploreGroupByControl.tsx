import { TSource } from '@hyperdx/common-utils/dist/types';
import { Popover } from '@mantine/core';

import { FieldPicker, FieldPickerTarget } from '@/components/FieldPicker';

import { formatGroupByFields, parseGroupByFields } from './exploreGroupBy';

function triggerLabel(selected: string[], fallback?: string) {
  if (selected.length === 1) return selected[0];
  if (selected.length > 1) return `${selected.length} fields`;
  return fallback || 'nothing';
}

/**
 * Group by for the view, not for the set of series. Events and Charts describe
 * the same dimension — the events histogram has always been a stacked bar with
 * a grouping, it was just pinned to severity or status code — so keeping one
 * control in the toolbar is what lets the grouping survive a view switch
 * instead of being rebuilt on each side.
 */
export function ExploreGroupByControl({
  tableSource,
  value,
  onApply,
  dateRange,
  defaultGroupBy,
  disabled,
}: {
  tableSource?: TSource;
  /** Comma-separated, as the query layer expects. */
  value: string;
  onApply: (next: string) => void;
  dateRange?: [Date, Date];
  /** Applied when nothing is picked; shown on the trigger so it is not a secret. */
  defaultGroupBy?: string;
  disabled?: boolean;
}) {
  const selected = parseGroupByFields(value);

  return (
    <FieldPicker
      tableSource={tableSource}
      dateRange={dateRange}
      selection="multi"
      selected={selected}
      onApply={fields => onApply(formatGroupByFields(fields))}
      sqlPlaceholder={defaultGroupBy || "ResourceAttributes['cloud.region']"}
      sqlMultiline
      sqlMinHeight={72}
      trigger={({ toggle }) => (
        <Popover.Target>
          <FieldPickerTarget
            label="Group by"
            value={triggerLabel(selected, defaultGroupBy)}
            muted={selected.length === 0}
            disabled={disabled}
            onClick={toggle}
            aria-label={`Group by ${triggerLabel(selected, defaultGroupBy)}`}
            containerTestId="explore-group-by"
            data-testid="explore-group-by-target"
          />
        </Popover.Target>
      )}
    />
  );
}
