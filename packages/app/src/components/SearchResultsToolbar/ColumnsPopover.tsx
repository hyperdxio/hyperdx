import { useMemo, useRef, useState } from 'react';
import {
  DndContext,
  type DragEndEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TableConnection } from '@hyperdx/common-utils/dist/core/metadata';
import { splitAndTrimWithBracket } from '@hyperdx/common-utils/dist/core/utils';
import {
  ActionIcon,
  Autocomplete,
  Box,
  Button,
  Group,
  Stack,
  Text,
} from '@mantine/core';
import { IconColumns, IconGripVertical, IconX } from '@tabler/icons-react';

import SQLInlineEditor from '@/components/SQLEditor/SQLInlineEditor';
import { withMapKeyAlias } from '@/utils';

import { ClausePopover } from './ClausePopover';

const columnId = (item: string, index: number) => `${index}:${item}`;

function SortableColumn({
  id,
  label,
  onRemove,
}: {
  id: string;
  label: string;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <Box
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <Group gap={4} wrap="nowrap" align="center" w="100%">
        <ActionIcon
          variant="subtle"
          size="xs"
          aria-label={`Reorder ${label}`}
          style={{ cursor: 'grab', touchAction: 'none', flexShrink: 0 }}
          {...attributes}
          {...listeners}
        >
          <IconGripVertical size={14} />
        </ActionIcon>
        <Text
          size="xs"
          ff="monospace"
          lh={1.5}
          style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}
        >
          {label}
        </Text>
        <ActionIcon
          variant="subtle"
          size="xs"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          style={{ flexShrink: 0 }}
        >
          <IconX size={14} />
        </ActionIcon>
      </Group>
    </Box>
  );
}

export function ColumnsPopover({
  value,
  defaultValue,
  fieldOptions,
  knownColumns,
  onApply,
  tableConnection,
  sourceId,
  dateRange,
}: {
  /** The SELECT expression in the search form. */
  value: string;
  /** The source's SELECT, used while `value` is empty. */
  defaultValue: string;
  fieldOptions: string[];
  knownColumns: Set<string>;
  /** Called with the new SELECT and the items it no longer contains. */
  onApply: (select: string, removedItems: string[]) => void;
  tableConnection: TableConnection | undefined;
  sourceId?: string;
  dateRange?: [Date, Date];
}) {
  const [draft, setDraft] = useState(value);
  const [search, setSearch] = useState('');
  // Autocomplete writes the chosen option back into the input after
  // onOptionSubmit. Ignore that write so a picked map key keeps its alias.
  const ignoreNextChangeRef = useRef(false);

  // An empty stored SELECT means "use the source default". An empty draft does
  // not: the user may have removed every column before adding a replacement.
  const storedColumns = (select: string) =>
    splitAndTrimWithBracket(select || defaultValue);

  const count = storedColumns(value).length;
  const items = splitAndTrimWithBracket(draft);

  const options = useMemo(
    () => fieldOptions.filter(option => !items.includes(option)),
    [fieldOptions, items],
  );

  const addColumn = (column: string) => {
    const trimmed = column.trim();
    if (trimmed && !items.includes(trimmed)) {
      setDraft(
        [...items, withMapKeyAlias(trimmed, items, knownColumns)].join(', '),
      );
    }
    setSearch('');
  };

  const removeColumn = (item: string) => {
    setDraft(items.filter(i => i !== item).join(', '));
  };

  const columnIds = items.map(columnId);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
  );

  const reorderColumns = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = columnIds.indexOf(String(active.id));
    const to = columnIds.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    setDraft(arrayMove(items, from, to).join(', '));
  };

  return (
    <ClausePopover
      label={count > 0 ? `Columns (${count})` : 'Columns'}
      title={value || defaultValue}
      icon={<IconColumns size={14} />}
      initialMode="pick"
      onOpen={() => {
        // The form stores "" while the source default is in use. Show that
        // default as the editor value; Apply keeps "" unless it was edited.
        setDraft(value || defaultValue);
        setSearch('');
      }}
      onReset={() => {
        setDraft(defaultValue);
        setSearch('');
      }}
      resetDisabled={draft.trim() === defaultValue.trim()}
      onApply={() => {
        const baseline = value || defaultValue;
        // An empty form value means "use the source default", so resetting
        // stores "" instead of a copy of that default.
        const submitted =
          draft.trim() === defaultValue.trim()
            ? ''
            : draft === baseline
              ? value
              : draft;
        const next = storedColumns(submitted);
        onApply(
          submitted,
          storedColumns(value).filter(item => !next.includes(item)),
        );
      }}
      data-testid="search-columns-button"
      renderPick={() => (
        <Stack gap="xs">
          <Box mah={220} style={{ overflowX: 'hidden', overflowY: 'auto' }}>
            {items.length === 0 ? (
              <Text size="xs" c="dimmed">
                No columns selected.
              </Text>
            ) : (
              <DndContext sensors={sensors} onDragEnd={reorderColumns}>
                <SortableContext
                  items={columnIds}
                  strategy={verticalListSortingStrategy}
                >
                  <Stack gap={2} data-testid="search-columns-list">
                    {items.map((item, index) => (
                      <SortableColumn
                        key={columnId(item, index)}
                        id={columnId(item, index)}
                        label={item}
                        onRemove={() => removeColumn(item)}
                      />
                    ))}
                  </Stack>
                </SortableContext>
              </DndContext>
            )}
          </Box>
          <Group gap="xs" wrap="nowrap" align="center">
            <Autocomplete
              size="xs"
              placeholder="Search columns"
              value={search}
              onChange={next => {
                if (ignoreNextChangeRef.current) {
                  ignoreNextChangeRef.current = false;
                  return;
                }
                setSearch(next);
              }}
              onOptionSubmit={option => {
                ignoreNextChangeRef.current = true;
                setSearch(withMapKeyAlias(option, items, knownColumns));
              }}
              data={options}
              limit={50}
              comboboxProps={{ withinPortal: false }}
              style={{ flex: 1 }}
              data-testid="search-columns-add-input"
            />
            <Button
              variant="secondary"
              size="xs"
              disabled={!search.trim()}
              onClick={() => addColumn(search)}
              data-testid="search-columns-add-button"
            >
              Add
            </Button>
          </Group>
          <Text size="xs" c="dimmed">
            Select a column, or type an expression such as upper(Body) as
            message, then click Add.
          </Text>
        </Stack>
      )}
      renderSql={apply => (
        <div data-testid="search-select-input">
          <SQLInlineEditor
            tableConnection={tableConnection}
            value={draft}
            onChange={setDraft}
            placeholder="SELECT"
            onSubmit={apply}
            label="SELECT"
            size="xs"
            allowMultiline
            dateRange={dateRange}
            sourceId={sourceId}
          />
        </div>
      )}
    />
  );
}
