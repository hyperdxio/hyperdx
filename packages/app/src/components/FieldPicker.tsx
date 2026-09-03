import { useMemo, useState } from 'react';
import {
  type Field,
  tcFromSource,
} from '@hyperdx/common-utils/dist/core/metadata';
import { TSource } from '@hyperdx/common-utils/dist/types';
import {
  Box,
  Button,
  Checkbox,
  Group,
  Popover,
  Radio,
  ScrollArea,
  SegmentedControl,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';

import { fieldIdentifier } from '@/components/Explore/fieldIdentifier';
import SQLInlineEditor from '@/components/SQLEditor/SQLInlineEditor';
import { useMultipleAllFields } from '@/hooks/useMetadata';

import classes from './FieldPicker.module.scss';

export type FieldPickerSelection = 'single' | 'multi';

/** The SQL tab needs the room; the field list reads better narrow. */
const DEFAULT_WIDTH = { fields: 360, sql: 520 };

/**
 * A field with a fixed left addon — "Group by | ServiceName". The common
 * trigger shape across the toolbar; event patterns keeps its own plain button
 * because it sits outside that row.
 *
 * The visible label is a sibling of the button rather than its content, so
 * pass `aria-label` carrying the whole phrase: without it the button announces
 * a bare field name and the operation is lost.
 */
export function FieldPickerTarget({
  label,
  value,
  muted,
  disabled,
  onClick,
  containerTestId,
  tall,
  ref,
  className,
  ...rest
}: {
  label: string;
  value: string;
  /** Dims the value to mark it as a fallback rather than a choice. */
  muted?: boolean;
  disabled?: boolean;
  onClick: () => void;
  'aria-label': string;
  'data-testid'?: string;
  containerTestId?: string;
  /** Match the 36px Mantine input beside it instead of the 32px toolbar row. */
  tall?: boolean;
  /** Popover.Target clones this and hands the ref down. */
  ref?: React.Ref<HTMLButtonElement>;
  className?: string;
}) {
  return (
    <div className={classes.control} data-testid={containerTestId}>
      <Text size="xs" fw={500} className={classes.label}>
        {label}
      </Text>
      {/* Popover.Target clones this with props of its own, `className` among
          them, so the spread has to come first or the target renders unstyled:
          the value overflows the field and the chevron wraps below it. */}
      <UnstyledButton
        {...rest}
        ref={ref}
        className={[classes.target, tall && classes.tall, className]
          .filter(Boolean)
          .join(' ')}
        disabled={disabled}
        onClick={onClick}
      >
        <Text
          size="xs"
          fw={600}
          className={classes.value}
          c={muted ? 'dimmed' : undefined}
        >
          {value}
        </Text>
        <IconChevronDown size={14} />
      </UnstyledButton>
    </div>
  );
}

/**
 * "Pick a field" as a popover: a searchable list of the source's fields, plus
 * a SQL tab for the expressions a list cannot offer.
 *
 * The trigger is a render prop rather than a prop of its own because the three
 * callers genuinely differ — group by and the series column are labelled addon
 * fields, event patterns a button — and the caller places `Popover.Target`
 * itself so it can decide how much of the trigger is the clickable part.
 *
 * Fields load lazily on open: several of these sit in one toolbar, and a field
 * list is a query against the table.
 */
export function FieldPicker({
  tableSource,
  dateRange,
  selection,
  selected,
  onApply,
  trigger,
  sqlPlaceholder,
  description,
  hint,
  secondaryAction,
  filterField,
  emptyLabel = 'No fields found',
  sqlMultiline = false,
  sqlMinHeight,
  sqlSize,
  enableVariables,
  width = DEFAULT_WIDTH,
}: {
  tableSource?: TSource;
  dateRange?: [Date, Date];
  selection: FieldPickerSelection;
  /** Committed fields. Pinned to the top of the list and kept even when absent
   *  from the schema: an expression typed on the SQL tab is still a choice. */
  selected: string[];
  /** The SQL tab passes its whole expression as a single entry. */
  onApply: (next: string[]) => void;
  trigger: (args: { opened: boolean; toggle: () => void }) => React.ReactNode;
  sqlPlaceholder?: string;
  /** Above the tabs — what this picker decides. */
  description?: React.ReactNode;
  /** Below the list — why the list is not everything. */
  hint?: React.ReactNode;
  /** Single-select only — "Use default". Multi-select gets a Clear that
   *  resets the draft, which the caller cannot reach. */
  secondaryAction?: { label: string; disabled?: boolean; onClick: () => void };
  /** Narrows what is offered, e.g. numeric fields only for a percentile. The
   *  SQL tab is deliberately left unfiltered — it is the escape hatch. */
  filterField?: (field: Field) => boolean;
  emptyLabel?: string;
  sqlMultiline?: boolean;
  sqlMinHeight?: number;
  sqlSize?: string;
  enableVariables?: boolean;
  width?: { fields: number; sql: number };
}) {
  const [opened, setOpened] = useState(false);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'fields' | 'sql'>('fields');
  const [draft, setDraft] = useState<string[]>(selected);
  const [sqlDraft, setSqlDraft] = useState('');

  // Reopening starts from what is committed rather than from an abandoned
  // edit, which a later Apply would otherwise send.
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setDraft(selected);
      setSqlDraft(selected.join(', '));
      setSearch('');
      setMode('fields');
    }
    setOpened(next);
  };

  const tableConnection = tcFromSource(tableSource);
  const { data: fields } = useMultipleAllFields(
    tableConnection ? [tableConnection] : [],
    {
      dateRange,
      timestampValueExpression: tableSource?.timestampValueExpression,
      enabled: opened && Boolean(tableConnection),
    },
  );

  // Nested map keys belong here — `ResourceAttributes['host']` is as ordinary a
  // choice as a top-level column, so this is every field rather than the
  // table's columns.
  const available = useMemo(
    () =>
      (fields ?? [])
        .filter(field => !filterField || filterField(field))
        .map(fieldIdentifier),
    [fields, filterField],
  );

  const options = useMemo(() => {
    const q = search.trim().toLowerCase();
    const union = Array.from(new Set([...selected, ...available]));
    return q ? union.filter(f => f.toLowerCase().includes(q)) : union;
  }, [search, available, selected]);

  const commit = (next: string[]) => {
    onApply(next);
    setOpened(false);
  };

  return (
    <Popover
      opened={opened}
      onChange={handleOpenChange}
      position="bottom-start"
      withinPortal
      shadow="md"
      width={mode === 'sql' ? width.sql : width.fields}
    >
      {trigger({ opened, toggle: () => handleOpenChange(!opened) })}
      <Popover.Dropdown p="xs">
        {description ? (
          <Text size="xs" c="dimmed" mb="xs">
            {description}
          </Text>
        ) : null}
        <SegmentedControl
          fullWidth
          size="xs"
          mb="xs"
          value={mode}
          onChange={next => setMode(next === 'sql' ? 'sql' : 'fields')}
          data={[
            { label: 'Fields', value: 'fields' },
            { label: 'SQL', value: 'sql' },
          ]}
        />
        {mode === 'sql' ? (
          <Box>
            <SQLInlineEditor
              tableConnection={tableConnection}
              value={sqlDraft}
              onChange={setSqlDraft}
              onSubmit={() => commit([sqlDraft])}
              placeholder={sqlPlaceholder}
              size={sqlSize}
              allowMultiline={sqlMultiline}
              minHeight={sqlMinHeight}
              disableKeywordAutocomplete
              enableVariables={enableVariables}
              sourceId={tableSource?.id}
              dateRange={dateRange}
            />
            <Button
              variant="primary"
              fullWidth
              size="xs"
              mt="xs"
              onClick={() => commit([sqlDraft])}
            >
              Apply
            </Button>
          </Box>
        ) : (
          <>
            <TextInput
              size="xs"
              placeholder="Search fields…"
              value={search}
              onChange={e => setSearch(e.currentTarget.value)}
              mb="xs"
              autoFocus
            />
            <ScrollArea.Autosize mah={260} type="auto">
              <Box>
                {options.length === 0 ? (
                  <Text size="xs" c="dimmed" py="xs" ta="center">
                    {emptyLabel}
                  </Text>
                ) : selection === 'single' ? (
                  <Radio.Group
                    value={selected[0] ?? ''}
                    onChange={field => commit([field])}
                  >
                    {options.map(field => (
                      <Radio
                        key={field}
                        size="xs"
                        my={4}
                        value={field}
                        label={field}
                      />
                    ))}
                  </Radio.Group>
                ) : (
                  options.map(field => (
                    <Checkbox
                      key={field}
                      size="xs"
                      my={4}
                      label={field}
                      checked={draft.includes(field)}
                      onChange={() =>
                        setDraft(prev =>
                          prev.includes(field)
                            ? prev.filter(f => f !== field)
                            : [...prev, field],
                        )
                      }
                    />
                  ))
                )}
              </Box>
            </ScrollArea.Autosize>
            {hint ? (
              <Text size="xs" c="dimmed" mt="xs">
                {hint}
              </Text>
            ) : null}
            <Group gap="xs" mt="xs" grow>
              {selection === 'multi' ? (
                <>
                  {/* Clears the in-flight draft rather than committing, so
                      Clear then Apply is how you group by nothing. */}
                  <Button
                    variant="secondary"
                    size="xs"
                    disabled={draft.length === 0}
                    onClick={() => setDraft([])}
                  >
                    Clear
                  </Button>
                  <Button size="xs" onClick={() => commit(draft)}>
                    Apply
                  </Button>
                </>
              ) : (
                // Single-select commits on pick, so an Apply here would only
                // ever re-send what the radio already sent.
                secondaryAction && (
                  <Button
                    variant="secondary"
                    size="xs"
                    disabled={secondaryAction.disabled}
                    onClick={secondaryAction.onClick}
                  >
                    {secondaryAction.label}
                  </Button>
                )
              )}
            </Group>
          </>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
