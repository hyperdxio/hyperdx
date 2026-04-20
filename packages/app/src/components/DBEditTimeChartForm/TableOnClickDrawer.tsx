import { useCallback, useEffect, useMemo } from 'react';
import { Control, Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  TableOnClick,
  TableOnClickFilterTemplate,
  TableOnClickSchema,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Box,
  Button,
  Divider,
  Drawer,
  Group,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';

import { useDashboards } from '@/dashboard';
import { useSources } from '@/source';

const HELP_TEXT =
  'Use Handlebars syntax to reference the column values of the clicked row. Example: {{ServiceName}}. Helpers: {{int Duration}}.';

type DrawerFormValues = { onClick: TableOnClick };

// Wrap the shared schema so the drawer validates the whole form object,
// not just the nested onClick union. Keeping it local also lets us tighten
// validation later (e.g., required filter templates) without affecting the
// persisted saved-chart schema.
const DrawerSchema = z.object({ onClick: TableOnClickSchema });

function emptyDashboardOnClick(): TableOnClick {
  return {
    type: 'dashboard',
    target: { mode: 'id', dashboardId: '' },
    whereLanguage: 'sql',
  };
}

function emptySearchOnClick(): TableOnClick {
  return {
    type: 'search',
    source: { mode: 'id', sourceId: '' },
    whereLanguage: 'sql',
  };
}

function noneOnClick(): TableOnClick {
  return { type: 'none' };
}

type TableOnClickDrawerProps = {
  opened: boolean;
  value: TableOnClick | undefined;
  onChange: (next: TableOnClick) => void;
  onClose: () => void;
};

export default function TableOnClickDrawer({
  opened,
  value,
  onChange,
  onClose,
}: TableOnClickDrawerProps) {
  const appliedDefaults: DrawerFormValues = useMemo(
    () => ({ onClick: value ?? noneOnClick() }),
    [value],
  );

  const { control, handleSubmit, reset, setValue } = useForm<DrawerFormValues>({
    defaultValues: appliedDefaults,
    resolver: zodResolver(DrawerSchema),
  });

  // Whenever the drawer is (re)opened with a fresh value from the parent,
  // sync the local form to that value. Reopening after a cancel should not
  // resurrect abandoned edits.
  useEffect(() => {
    if (opened) reset(appliedDefaults);
  }, [opened, appliedDefaults, reset]);

  const applyChanges = useCallback(() => {
    handleSubmit(values => {
      onChange(values.onClick);
      onClose();
    })();
  }, [handleSubmit, onChange, onClose]);

  const handleClose = useCallback(() => {
    reset(appliedDefaults);
    onClose();
  }, [reset, appliedDefaults, onClose]);

  const resetToDefaults = useCallback(() => {
    reset({ onClick: noneOnClick() });
  }, [reset]);

  return (
    <Drawer
      title="On Row Click"
      opened={opened}
      onClose={handleClose}
      position="right"
      size="lg"
    >
      <Stack>
        <Text size="xs" c="dimmed">
          {HELP_TEXT}
        </Text>

        <Controller
          control={control}
          name="onClick"
          render={({ field: { value: onClickValue } }) => (
            <SegmentedControl
              data={[
                { label: 'Default', value: 'none' },
                { label: 'Dashboard', value: 'dashboard' },
                { label: 'Search', value: 'search' },
              ]}
              value={onClickValue?.type ?? 'none'}
              onChange={next => {
                if (next === 'none') setValue('onClick', noneOnClick());
                else if (next === 'dashboard')
                  setValue('onClick', emptyDashboardOnClick());
                else if (next === 'search')
                  setValue('onClick', emptySearchOnClick());
              }}
              fullWidth
            />
          )}
        />

        <ModeFields control={control} setValue={setValue} />

        <Divider />
        <Group justify="space-between">
          <Button variant="secondary" onClick={resetToDefaults}>
            Reset
          </Button>
          <Group>
            <Button variant="subtle" onClick={handleClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={applyChanges}>
              Apply
            </Button>
          </Group>
        </Group>
      </Stack>
    </Drawer>
  );
}

function ModeFields({
  control,
  setValue,
}: {
  control: Control<DrawerFormValues>;
  setValue: (name: 'onClick', value: TableOnClick) => void;
}) {
  const onClick = useWatch({ control, name: 'onClick' });
  if (!onClick) return null;

  if (onClick.type === 'dashboard') {
    return <DashboardOnClickFields onClick={onClick} setValue={setValue} />;
  }

  if (onClick.type === 'search') {
    return <SearchOnClickFields onClick={onClick} setValue={setValue} />;
  }

  // Default (type: 'none')
  return (
    <Text size="sm" c="dimmed">
      Clicking a row opens the search page, pre-filtered by the row&apos;s
      group-by column values and the current dashboard&apos;s time range.
    </Text>
  );
}

function DashboardOnClickFields({
  onClick,
  setValue,
}: {
  onClick: Extract<TableOnClick, { type: 'dashboard' }>;
  setValue: (name: 'onClick', value: TableOnClick) => void;
}) {
  const { data: dashboards } = useDashboards();

  const dashboardOptions = useMemo(
    () => (dashboards ?? []).map(d => ({ value: d.id, label: d.name })),
    [dashboards],
  );

  const mode = onClick.target.mode;

  return (
    <Stack gap="xs">
      <SegmentedControl
        data={[
          { label: 'By Dashboard', value: 'id' },
          { label: 'By Name (templated)', value: 'name-template' },
        ]}
        value={mode}
        onChange={next => {
          if (next === 'id') {
            setValue('onClick', {
              ...onClick,
              target: { mode: 'id', dashboardId: '' },
            });
          } else {
            setValue('onClick', {
              ...onClick,
              target: { mode: 'name-template', nameTemplate: '' },
            });
          }
        }}
      />

      {mode === 'id' && (
        <Select
          label="Target dashboard"
          placeholder="Select a dashboard"
          searchable
          data={dashboardOptions}
          value={onClick.target.mode === 'id' ? onClick.target.dashboardId : ''}
          onChange={next => {
            setValue('onClick', {
              ...onClick,
              target: { mode: 'id', dashboardId: next ?? '' },
            });
          }}
        />
      )}

      {mode === 'name-template' && (
        <TextInput
          label="Target dashboard name (Handlebars)"
          description="Rendered per row. Target name must match exactly one dashboard on your team."
          placeholder="{{ServiceName}} Errors"
          value={
            onClick.target.mode === 'name-template'
              ? onClick.target.nameTemplate
              : ''
          }
          onChange={e => {
            setValue('onClick', {
              ...onClick,
              target: {
                mode: 'name-template',
                nameTemplate: e.currentTarget.value,
              },
            });
          }}
        />
      )}

      <Textarea
        label="Global WHERE template (optional)"
        placeholder="ServiceName = '{{ServiceName}}'"
        autosize
        minRows={2}
        value={onClick.whereTemplate ?? ''}
        onChange={e => {
          setValue('onClick', {
            ...onClick,
            whereTemplate: e.currentTarget.value || undefined,
          });
        }}
      />

      <SegmentedControl
        data={[
          { label: 'SQL', value: 'sql' },
          { label: 'Lucene', value: 'lucene' },
        ]}
        value={onClick.whereLanguage ?? 'sql'}
        onChange={next => {
          setValue('onClick', {
            ...onClick,
            whereLanguage: next as 'sql' | 'lucene',
          });
        }}
      />

      <FilterExpressionList
        entries={onClick.filterValueTemplates ?? []}
        onChange={entries =>
          setValue('onClick', {
            ...onClick,
            filterValueTemplates: entries.length === 0 ? undefined : entries,
          })
        }
      />
    </Stack>
  );
}

function upsertFilterEntries(
  entries: TableOnClickFilterTemplate[],
  index: number,
  next: Partial<TableOnClickFilterTemplate>,
): TableOnClickFilterTemplate[] {
  const copy = [...entries];
  const current = copy[index] ?? { filter: '', template: '' };
  copy[index] = { ...current, ...next };
  return copy;
}

/**
 * User-managed list of `{expression, value-template}` rows. Expression is
 * treated as raw SQL on the destination, so the URL builder can emit
 * `expression IN (value)` without consulting the target dashboard's filter
 * metadata. Used by both dashboard and search onClick modes.
 */
function FilterExpressionList({
  entries,
  onChange,
}: {
  entries: TableOnClickFilterTemplate[];
  onChange: (next: TableOnClickFilterTemplate[]) => void;
}) {
  return (
    <Box>
      <Text size="sm" fw={500} mb={4}>
        Filters
      </Text>
      <Text size="xs" c="dimmed" mb="xs">
        Enter an expression (e.g. a column name) and a Handlebars template for
        its value.
      </Text>
      <Stack gap="xs">
        {entries.map((entry, i) => (
          <Group key={i} gap="xs" align="flex-end" wrap="nowrap">
            <TextInput
              label={i === 0 ? 'Expression' : undefined}
              placeholder="ServiceName"
              value={entry.filter}
              onChange={e =>
                onChange(
                  upsertFilterEntries(entries, i, {
                    filter: e.currentTarget.value,
                  }),
                )
              }
              style={{ flex: 1 }}
            />
            <TextInput
              label={i === 0 ? 'Value template' : undefined}
              placeholder="{{ServiceName}}"
              value={entry.template}
              onChange={e =>
                onChange(
                  upsertFilterEntries(entries, i, {
                    template: e.currentTarget.value,
                  }),
                )
              }
              style={{ flex: 1 }}
            />
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label="Remove filter row"
              onClick={() => onChange(entries.filter((_, j) => j !== i))}
            >
              <IconTrash size={14} />
            </ActionIcon>
          </Group>
        ))}
        <Button
          variant="subtle"
          size="compact-sm"
          leftSection={<IconPlus size={14} />}
          onClick={() => onChange([...entries, { filter: '', template: '' }])}
          style={{ alignSelf: 'flex-start' }}
        >
          Add filter
        </Button>
      </Stack>
    </Box>
  );
}

function SearchOnClickFields({
  onClick,
  setValue,
}: {
  onClick: Extract<TableOnClick, { type: 'search' }>;
  setValue: (name: 'onClick', value: TableOnClick) => void;
}) {
  const { data: sources } = useSources();
  const sourceOptions = useMemo(
    () => (sources ?? []).map(s => ({ value: s.id, label: s.name })),
    [sources],
  );

  const mode = onClick.source.mode;

  return (
    <Stack gap="xs">
      <SegmentedControl
        data={[
          { label: 'By Source', value: 'id' },
          { label: 'By Name (templated)', value: 'template' },
        ]}
        value={mode}
        onChange={next => {
          if (next === 'id') {
            setValue('onClick', {
              ...onClick,
              source: { mode: 'id', sourceId: '' },
            });
          } else {
            setValue('onClick', {
              ...onClick,
              source: { mode: 'template', sourceTemplate: '' },
            });
          }
        }}
      />

      {mode === 'id' && (
        <Select
          label="Target source"
          placeholder="Select a source"
          searchable
          data={sourceOptions}
          value={onClick.source.mode === 'id' ? onClick.source.sourceId : ''}
          onChange={next => {
            setValue('onClick', {
              ...onClick,
              source: { mode: 'id', sourceId: next ?? '' },
            });
          }}
        />
      )}

      {mode === 'template' && (
        <TextInput
          label="Source template"
          description="Resolves to a source name (case-insensitive)"
          placeholder="Logs-{{SourceName}}"
          value={
            onClick.source.mode === 'template'
              ? onClick.source.sourceTemplate
              : ''
          }
          onChange={e => {
            setValue('onClick', {
              ...onClick,
              source: {
                mode: 'template',
                sourceTemplate: e.currentTarget.value,
              },
            });
          }}
        />
      )}

      <Textarea
        label="WHERE template"
        placeholder="ServiceName = '{{ServiceName}}'"
        autosize
        minRows={2}
        value={onClick.whereTemplate ?? ''}
        onChange={e => {
          setValue('onClick', {
            ...onClick,
            whereTemplate: e.currentTarget.value || undefined,
          });
        }}
      />

      <SegmentedControl
        data={[
          { label: 'SQL', value: 'sql' },
          { label: 'Lucene', value: 'lucene' },
        ]}
        value={onClick.whereLanguage ?? 'sql'}
        onChange={next => {
          setValue('onClick', {
            ...onClick,
            whereLanguage: next as 'sql' | 'lucene',
          });
        }}
      />

      <FilterExpressionList
        entries={onClick.filterValueTemplates ?? []}
        onChange={entries =>
          setValue('onClick', {
            ...onClick,
            filterValueTemplates: entries.length === 0 ? undefined : entries,
          })
        }
      />
    </Stack>
  );
}
