import { CSSProperties, useState } from 'react';
import { ActionIcon, Popover, Text, Tooltip } from '@mantine/core';
import { IconX } from '@tabler/icons-react';

const pillStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '1px 6px',
  borderRadius: 3,
  fontSize: 11,
  lineHeight: '18px',
  whiteSpace: 'nowrap',
  maxWidth: 260,
  overflow: 'hidden',
};

export type FilterPillProps = {
  field: string;
  /** Display label for the operator, e.g. `=`, `regex`, `:`. */
  operator: string;
  value: string;
  /** Display-only label for the value (e.g. a locale-formatted DateTime). */
  displayValue?: string;
  /** A negated condition, shown with the danger accent. */
  isExcluded?: boolean;
  /**
   * A filter that's in state but not applied to the query. Rendered muted with
   * a dashed border, and can only be removed.
   */
  isInvalid?: boolean;
  invalidReason?: string;
  onRemove: () => void;
  /**
   * Content of the popover opened by clicking the pill. Omit for a remove-only
   * pill. `close` dismisses the popover.
   */
  renderPopover?: (close: () => void) => React.ReactNode;
  /** Lets callers fetch popover data lazily. */
  onOpenedChange?: (opened: boolean) => void;
  'data-testid'?: string;
};

/** A removable `field operator value` chip that can open an edit popover. */
export function FilterPill({
  field,
  operator,
  value,
  displayValue,
  isExcluded = false,
  isInvalid = false,
  invalidReason,
  onRemove,
  renderPopover,
  onOpenedChange,
  'data-testid': testId,
}: FilterPillProps) {
  const [opened, setOpened] = useState(false);
  const changeOpened = (next: boolean) => {
    setOpened(next);
    onOpenedChange?.(next);
  };

  const isEditable = renderPopover != null && !isInvalid;
  const showDangerAccent = isExcluded && !isInvalid;
  const label = displayValue ?? value;
  const strikethrough = isInvalid ? 'line-through' : undefined;
  // `:` reads as a label separator (`duration: 100 – 500`), not an infix operator.
  const operatorText = operator === ':' ? ': ' : ` ${operator} `;
  const tooltipLabel = isInvalid
    ? (invalidReason ??
      `Filter not applied: "${field}" isn't a column on the current source. It will reapply if you switch back.`)
    : `${field}${operatorText}${label}`;

  const pill = (
    <Tooltip
      label={tooltipLabel}
      openDelay={300}
      multiline
      maw={280}
      disabled={isEditable && opened}
    >
      <span
        data-testid={testId}
        data-invalid={isInvalid ? 'true' : undefined}
        onClick={isEditable ? () => changeOpened(!opened) : undefined}
        style={{
          ...pillStyle,
          cursor: isEditable ? 'pointer' : 'default',
          backgroundColor: isInvalid
            ? 'transparent'
            : isExcluded
              ? 'var(--mantine-color-red-light)'
              : 'var(--color-bg-hover)',
          border: isInvalid
            ? '1px dashed var(--color-border-emphasis)'
            : '1px solid transparent',
          opacity: isInvalid ? 0.75 : 1,
        }}
      >
        <Text
          span
          size="xxs"
          c="dimmed"
          fw={500}
          maw={100}
          truncate="start"
          style={{ flexShrink: 0, textDecoration: strikethrough }}
        >
          {field}
        </Text>
        <Text
          span
          size="xxs"
          c="dimmed"
          style={{
            color: showDangerAccent
              ? 'var(--mantine-color-red-light-color)'
              : undefined,
            textDecoration: strikethrough,
          }}
        >
          {operatorText}
        </Text>
        <Text
          span
          size="xxs"
          fw={500}
          truncate
          style={{ textDecoration: strikethrough }}
        >
          {label}
        </Text>
        <ActionIcon
          size={14}
          variant="subtle"
          color="gray"
          onClick={e => {
            // Remove in one click without also toggling the popover.
            e.stopPropagation();
            onRemove();
          }}
          style={{
            flexShrink: 0,
            marginLeft: 2,
            color: showDangerAccent
              ? 'var(--mantine-color-red-light-color)'
              : undefined,
          }}
          aria-label="Remove filter"
        >
          <IconX size={9} />
        </ActionIcon>
      </span>
    </Tooltip>
  );

  if (!isEditable) {
    return pill;
  }

  return (
    <Popover
      position="bottom-start"
      withArrow
      shadow="md"
      radius="sm"
      opened={opened}
      onChange={changeOpened}
    >
      <Popover.Target>{pill}</Popover.Target>
      <Popover.Dropdown p={6}>
        {renderPopover(() => changeOpened(false))}
      </Popover.Dropdown>
    </Popover>
  );
}
