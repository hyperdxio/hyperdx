import { TSource } from '@hyperdx/common-utils/dist/types';
import { Button, Popover, Text } from '@mantine/core';
import { IconBracketsContain, IconChevronDown } from '@tabler/icons-react';

import { FieldPicker } from '@/components/FieldPicker';

function triggerLabel(value: string, fallback?: string) {
  return value.trim() || fallback || 'default';
}

/**
 * Which field Drain reads when clustering events.
 *
 * Single-select, unlike Group by — Drain clusters one string per event.
 */
export function PatternColumnSelector({
  tableSource,
  value,
  onApply,
  dateRange,
  defaultField,
  disabled,
}: {
  tableSource?: TSource;
  /** Committed column or SQL expression; empty means the source default. */
  value: string;
  onApply: (next: string) => void;
  dateRange?: [Date, Date];
  /** Source body / span name, shown on the trigger so the default is not a secret. */
  defaultField?: string;
  disabled?: boolean;
}) {
  const effective = value.trim() || defaultField || '';

  // Storing the default explicitly would freeze today's source default into
  // the URL, so picking it is recorded as picking nothing.
  const commit = (next: string) => {
    const trimmed = next.trim();
    onApply(trimmed === defaultField ? '' : trimmed);
  };

  return (
    <FieldPicker
      tableSource={tableSource}
      dateRange={dateRange}
      selection="single"
      selected={effective ? [effective] : []}
      onApply={fields => commit(fields[0] ?? '')}
      description="Events that share the same shape in this field are grouped. Sampled from up to 10,000 events."
      sqlPlaceholder={
        defaultField
          ? `Default (${defaultField}) — column or expression`
          : 'Column or expression'
      }
      sqlSize="xs"
      width={{ fields: 300, sql: 300 }}
      secondaryAction={{
        label: 'Use default',
        disabled: !value.trim(),
        onClick: () => commit(''),
      }}
      trigger={({ toggle }) => (
        <Popover.Target>
          <Button
            variant="secondary"
            size="xs"
            disabled={disabled}
            leftSection={<IconBracketsContain size={14} />}
            rightSection={<IconChevronDown size={14} />}
            onClick={toggle}
            data-testid="explore-pattern-field"
            style={{ flexShrink: 0 }}
          >
            <Text
              size="xs"
              span
              c={!value.trim() ? 'dimmed' : undefined}
              style={{
                maxWidth: 220,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              on {triggerLabel(value, defaultField)}
            </Text>
          </Button>
        </Popover.Target>
      )}
    />
  );
}
