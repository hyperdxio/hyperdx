import React, { useCallback } from 'react';
import {
  DndContext,
  DragEndEvent,
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
import type {
  ChartPaletteToken,
  ColorCondition,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Box,
  Button,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { IconGripVertical, IconTrash } from '@tabler/icons-react';

import { ColorSwatchInput } from './ColorSwatchInput';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A ColorCondition with a client-side `localId` used as a stable dnd-kit key. */
export type ColorRuleWithId = ColorCondition & { localId: string };

type ColorRulesEditorProps = {
  value: ColorRuleWithId[];
  onChange: (rules: ColorRuleWithId[]) => void;
};

// ─── Operator options (number-tile subset) ────────────────────────────────────

const OPERATOR_OPTIONS = [
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'between', label: 'between' },
  { value: 'eq', label: '=' },
  { value: 'neq', label: '≠' },
] as const;

type NumericTileOperator = (typeof OPERATOR_OPTIONS)[number]['value'];

/** Default rule added when the user clicks "Add rule". */
function makeDefaultRule(): ColorRuleWithId {
  return {
    localId: crypto.randomUUID(),
    operator: 'gt',
    value: 0,
    color: 'chart-blue',
  };
}

// ─── Single sortable rule row ─────────────────────────────────────────────────

function SortableRuleRow({
  rule,
  index,
  onUpdate,
  onDelete,
}: {
  rule: ColorRuleWithId;
  index: number;
  onUpdate: (index: number, next: ColorRuleWithId) => void;
  onDelete: (index: number) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: rule.localId });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleOperatorChange = useCallback(
    (op: string | null) => {
      if (!op) return;
      const operator = op as NumericTileOperator;
      // When switching to/from 'between', reset the value to a valid shape.
      if (operator === 'between') {
        onUpdate(index, {
          ...rule,
          operator: 'between',
          value: [0, 100],
        } as ColorRuleWithId);
      } else if (operator === 'eq' || operator === 'neq') {
        // eq/neq accept number or string; default to number 0
        const currentVal =
          rule.operator !== 'between' && typeof rule.value === 'number'
            ? rule.value
            : 0;
        onUpdate(index, {
          ...rule,
          operator,
          value: currentVal,
        } as ColorRuleWithId);
      } else {
        // Numeric ordered: gt/gte/lt/lte need a number
        const currentVal =
          rule.operator !== 'between' && typeof rule.value === 'number'
            ? rule.value
            : 0;
        onUpdate(index, {
          ...rule,
          operator,
          value: currentVal,
        } as ColorRuleWithId);
      }
    },
    [index, onUpdate, rule],
  );

  const handleColorChange = useCallback(
    (color?: ChartPaletteToken) => {
      onUpdate(index, { ...rule, color: color ?? 'chart-blue' });
    },
    [index, onUpdate, rule],
  );

  const handleDelete = useCallback(() => onDelete(index), [index, onDelete]);

  // Value inputs differ by operator
  let valueInputs: React.ReactNode;
  if (rule.operator === 'between') {
    const [lo, hi] = rule.value;
    valueInputs = (
      <Group gap={4} wrap="nowrap">
        <NumberInput
          size="xs"
          value={lo}
          onChange={v =>
            onUpdate(index, {
              ...rule,
              operator: 'between',
              value: [typeof v === 'number' ? v : 0, hi],
            } as ColorRuleWithId)
          }
          aria-label={`Rule ${index + 1} lower bound`}
          w={72}
        />
        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
          to
        </Text>
        <NumberInput
          size="xs"
          value={hi}
          onChange={v =>
            onUpdate(index, {
              ...rule,
              operator: 'between',
              value: [lo, typeof v === 'number' ? v : 0],
            } as ColorRuleWithId)
          }
          aria-label={`Rule ${index + 1} upper bound`}
          w={72}
        />
      </Group>
    );
  } else if (rule.operator === 'eq' || rule.operator === 'neq') {
    // Accept text for eq/neq; if parseable as number convert it, else keep string
    const displayVal =
      typeof rule.value === 'number'
        ? String(rule.value)
        : (rule.value as string);
    valueInputs = (
      <TextInput
        size="xs"
        value={displayVal}
        onChange={e => {
          const raw = e.currentTarget.value;
          const num = Number(raw);
          const coerced =
            raw !== '' && !Number.isNaN(num) && Number.isFinite(num)
              ? num
              : raw;
          onUpdate(index, {
            ...rule,
            operator: rule.operator,
            value: coerced,
          } as ColorRuleWithId);
        }}
        aria-label={`Rule ${index + 1} value`}
        w={120}
      />
    );
  } else {
    // Numeric ordered: gt/gte/lt/lte
    valueInputs = (
      <NumberInput
        size="xs"
        value={typeof rule.value === 'number' ? rule.value : 0}
        onChange={v =>
          onUpdate(index, {
            ...rule,
            value: typeof v === 'number' ? v : 0,
          } as ColorRuleWithId)
        }
        aria-label={`Rule ${index + 1} value`}
        w={120}
      />
    );
  }

  return (
    <Box ref={setNodeRef} style={style} data-testid={`color-rule-row-${index}`}>
      <Group gap={6} wrap="nowrap" align="center">
        {/* Drag handle */}
        <ActionIcon
          variant="subtle"
          size="xs"
          aria-label="Drag to reorder"
          data-testid={`color-rule-drag-handle-${index}`}
          style={{ cursor: 'grab', touchAction: 'none', flexShrink: 0 }}
          {...attributes}
          {...listeners}
        >
          <IconGripVertical size={14} stroke={1.5} />
        </ActionIcon>

        {/* Operator */}
        <Select
          size="xs"
          data={OPERATOR_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
          value={rule.operator}
          onChange={handleOperatorChange}
          aria-label={`Rule ${index + 1} operator`}
          data-testid={`color-rule-operator-${index}`}
          w={80}
          allowDeselect={false}
          style={{ flexShrink: 0 }}
        />

        {/* Value input(s) */}
        {valueInputs}

        {/* Color picker */}
        <Box style={{ flexShrink: 0 }}>
          <ColorSwatchInput
            value={rule.color}
            onChange={handleColorChange}
            ariaLabel={`Rule ${index + 1} color`}
          />
        </Box>

        {/* Delete */}
        <ActionIcon
          variant="subtle"
          size="xs"
          color="red"
          aria-label={`Delete rule ${index + 1}`}
          data-testid={`color-rule-delete-${index}`}
          onClick={handleDelete}
          style={{ flexShrink: 0 }}
        >
          <IconTrash size={14} stroke={1.5} />
        </ActionIcon>
      </Group>
    </Box>
  );
}

// ─── ColorRulesEditor ─────────────────────────────────────────────────────────

const MAX_RULES = 10;

export function ColorRulesEditor({ value, onChange }: ColorRulesEditorProps) {
  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: { distance: 8 },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 200, tolerance: 5 },
  });
  const sensors = useSensors(mouseSensor, touchSensor);

  const sortableIds = value.map(r => r.localId);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const from = value.findIndex(r => r.localId === active.id);
      const to = value.findIndex(r => r.localId === over.id);
      if (from !== -1 && to !== -1) onChange(arrayMove(value, from, to));
    },
    [value, onChange],
  );

  const handleUpdate = useCallback(
    (index: number, next: ColorRuleWithId) => {
      const updated = [...value];
      updated[index] = next;
      onChange(updated);
    },
    [value, onChange],
  );

  const handleDelete = useCallback(
    (index: number) => {
      onChange(value.filter((_, i) => i !== index));
    },
    [value, onChange],
  );

  const handleAdd = useCallback(() => {
    if (value.length >= MAX_RULES) return;
    onChange([...value, makeDefaultRule()]);
  }, [value, onChange]);

  return (
    <Stack gap="xs">
      <Box>
        <Text size="xs" fw={500} mb={2}>
          Conditional colors
        </Text>
        <Text size="xs" c="dimmed">
          Falls back to the tile color when no rule matches.
        </Text>
      </Box>

      {value.length > 0 && (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext
            items={sortableIds}
            strategy={verticalListSortingStrategy}
          >
            <Stack gap={6}>
              {value.map((rule, i) => (
                <SortableRuleRow
                  key={rule.localId}
                  rule={rule}
                  index={i}
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                />
              ))}
            </Stack>
          </SortableContext>
        </DndContext>
      )}

      <Box>
        <Button
          variant="secondary"
          size="compact-xs"
          disabled={value.length >= MAX_RULES}
          onClick={handleAdd}
          data-testid="color-rules-add-button"
        >
          Add rule
        </Button>
      </Box>
    </Stack>
  );
}

/** Strip `localId` before persisting to the chart config. */
export function stripLocalIds(rules: ColorRuleWithId[]): ColorCondition[] {
  return rules.map(({ localId: _id, ...rest }) => rest as ColorCondition);
}

/** Attach stable `localId`s when loading rules from a saved config. */
export function attachLocalIds(rules: ColorCondition[]): ColorRuleWithId[] {
  return rules.map(r => ({ ...r, localId: crypto.randomUUID() }));
}
