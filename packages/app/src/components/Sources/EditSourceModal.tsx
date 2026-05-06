import React, { useEffect, useMemo, useState } from 'react';
import {
  SourceKind,
  TSource,
  TSourceNoId,
} from '@berg/common-utils/dist/types';
import {
  Alert,
  Button,
  Code,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  TagsInput,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle } from '@tabler/icons-react';

import { useTableSchema } from '@/hooks/useTableSchema';
import { useSaveSource } from '@/source';

export interface EditSourceModalProps {
  opened: boolean;
  onClose: () => void;
  /** Existing source for "Edit". Mutually exclusive with `defaults`. */
  source?: TSource;
  /**
   * Pre-fill values for "Save as Source" (from Catalog). Caller passes the
   * catalog/database/table reference plus the recommended timestamp column.
   */
  defaults?: {
    catalog: string;
    database: string;
    table: string;
    displayName?: string;
    timestampColumn?: string;
  };
}

interface FormState {
  displayName: string;
  catalog: string;
  database: string;
  table: string;
  timestampColumn: string; // empty string === "no time column"
  defaultSort: string;
  defaultColumns: string[];
}

function isTimeColumn(type: string): boolean {
  const lc = type.toLowerCase();
  return lc.startsWith('timestamp') || lc.startsWith('date');
}

function initialState(props: EditSourceModalProps): FormState {
  const { source, defaults } = props;
  if (source) {
    return {
      displayName: source.displayName || source.name || '',
      catalog: source.catalog || '',
      database: source.database || source.from?.databaseName || '',
      table: source.table || source.from?.tableName || '',
      timestampColumn:
        source.timestampColumn || source.timestampValueExpression || '',
      defaultSort: source.defaultSort || source.orderByExpression || '',
      defaultColumns: source.defaultColumns || [],
    };
  }
  if (defaults) {
    return {
      displayName: defaults.displayName || defaults.table,
      catalog: defaults.catalog,
      database: defaults.database,
      table: defaults.table,
      timestampColumn: defaults.timestampColumn || '',
      defaultSort: '',
      defaultColumns: [],
    };
  }
  return {
    displayName: '',
    catalog: '',
    database: '',
    table: '',
    timestampColumn: '',
    defaultSort: '',
    defaultColumns: [],
  };
}

const NO_TIME_VALUE = '__none__';

export function EditSourceModal(props: EditSourceModalProps) {
  const { opened, onClose, source } = props;
  const isEdit = !!source;

  const [form, setForm] = useState<FormState>(() => initialState(props));
  const [errors, setErrors] = useState<
    Partial<Record<keyof FormState, string>>
  >({});
  const saveSource = useSaveSource();

  // Reset state whenever the modal is reopened with different inputs.
  useEffect(() => {
    if (opened) {
      setForm(initialState(props));
      setErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, source?.id, props.defaults?.table]);

  const { data: schema, isLoading: isLoadingSchema } = useTableSchema(
    form.catalog || undefined,
    form.database || undefined,
    form.table || undefined,
  );

  const timeColumnOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [
      { value: NO_TIME_VALUE, label: '— None — flat table mode' },
    ];
    if (schema?.columns) {
      for (const col of schema.columns) {
        if (isTimeColumn(col.type)) {
          opts.push({ value: col.name, label: `${col.name} (${col.type})` });
        }
      }
    }
    // If the source already has a timestampColumn that's not in the schema
    // results yet, surface it so we don't show an empty selection.
    if (
      form.timestampColumn &&
      !opts.some(o => o.value === form.timestampColumn)
    ) {
      opts.push({
        value: form.timestampColumn,
        label: form.timestampColumn,
      });
    }
    return opts;
  }, [schema, form.timestampColumn]);

  const columnNameOptions = useMemo(
    () => schema?.columns.map(c => c.name) ?? [],
    [schema],
  );

  const tableRef = `${form.catalog || '?'}/${form.database || '?'}/${form.table || '?'}`;

  const validate = (): boolean => {
    const next: Partial<Record<keyof FormState, string>> = {};
    if (!form.displayName.trim()) {
      next.displayName = 'Display name is required';
    } else if (form.displayName.trim().length < 2) {
      next.displayName = 'Display name must be at least 2 characters';
    }
    if (!form.table) {
      next.table = 'Table reference is required';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;

    const tsCol =
      form.timestampColumn === NO_TIME_VALUE || form.timestampColumn === ''
        ? undefined
        : form.timestampColumn;

    // Berg-native source payload. The API model only persists the Berg
    // fields; `name`, `from`, `timestampValueExpression`, and `connection`
    // remain on the shared TableSource type purely so legacy chart-config
    // plumbing keeps type-checking — we mirror them from the Berg fields
    // (or pass an empty-string sentinel) rather than tracking them as
    // separate state.
    const payload: TSourceNoId & { id?: string } = {
      kind: SourceKind.Table,
      displayName: form.displayName.trim(),
      catalog: form.catalog,
      database: form.database,
      table: form.table,
      timestampColumn: tsCol,
      defaultSort: form.defaultSort.trim() || undefined,
      defaultColumns: form.defaultColumns.length
        ? form.defaultColumns
        : undefined,
      // ---- Legacy mirrored fields (read by chart code, not persisted) ----
      name: form.displayName.trim(),
      from: { databaseName: form.database, tableName: form.table },
      timestampValueExpression: tsCol ?? '',
      connection: '',
      ...(source?.id ? { id: source.id } : {}),
    };

    saveSource.mutate(payload, {
      onSuccess: () => {
        notifications.show({
          message: isEdit ? 'Source updated' : 'Source saved',
          color: 'green',
        });
        onClose();
      },
      onError: () => {
        notifications.show({
          message: isEdit ? 'Failed to update source' : 'Failed to save source',
          color: 'red',
        });
      },
    });
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={isEdit ? 'Edit Source' : 'Save as Source'}
      size="lg"
      data-testid="edit-source-modal"
    >
      <Stack gap="md">
        <TextInput
          label="Display name"
          required
          value={form.displayName}
          onChange={e =>
            setForm(prev => ({ ...prev, displayName: e.currentTarget.value }))
          }
          error={errors.displayName}
          data-testid="edit-source-display-name"
        />

        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Table
          </Text>
          <Code block data-testid="edit-source-table-ref">
            {tableRef}
          </Code>
          {errors.table && (
            <Text c="red" size="xs">
              {errors.table}
            </Text>
          )}
        </Stack>

        {isLoadingSchema && (
          <Group gap="xs">
            <Loader size="xs" />
            <Text size="xs" c="dimmed">
              Loading column metadata…
            </Text>
          </Group>
        )}

        {!isLoadingSchema && schema == null && form.table && (
          <Alert
            icon={<IconAlertCircle size={14} />}
            color="yellow"
            variant="light"
          >
            Couldn&apos;t fetch table schema — you can still save and pick the
            time column later.
          </Alert>
        )}

        <Select
          label="Time column"
          description="Used by the search histogram and time-DESC default sort."
          data={timeColumnOptions}
          value={form.timestampColumn || NO_TIME_VALUE}
          onChange={v =>
            setForm(prev => ({
              ...prev,
              timestampColumn: v === NO_TIME_VALUE ? '' : (v ?? ''),
            }))
          }
          searchable
          clearable={false}
          data-testid="edit-source-time-column"
        />

        <TextInput
          label="Default sort"
          description="Optional ORDER BY expression used when no explicit sort is set."
          placeholder="e.g. created_at DESC"
          value={form.defaultSort}
          onChange={e =>
            setForm(prev => ({ ...prev, defaultSort: e.currentTarget.value }))
          }
          data-testid="edit-source-default-sort"
        />

        <TagsInput
          label="Default visible columns"
          description="Columns shown in the row table when first opening the source."
          data={columnNameOptions}
          value={form.defaultColumns}
          onChange={v => setForm(prev => ({ ...prev, defaultColumns: v }))}
          clearable
          data-testid="edit-source-default-columns"
        />

        <Group justify="flex-end" mt="sm">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={saveSource.isPending}
            data-testid="edit-source-submit"
          >
            {isEdit ? 'Save changes' : 'Save Source'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export default EditSourceModal;
