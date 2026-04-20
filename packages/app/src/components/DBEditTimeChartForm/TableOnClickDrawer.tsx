import { useCallback, useEffect, useMemo, useRef } from 'react';
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
  TextInput,
} from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';

import SearchWhereInput from '@/components/SearchInput/SearchWhereInput';
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
    target: { mode: 'id', id: '' },
    whereLanguage: 'sql',
  };
}

function emptySearchOnClick(): TableOnClick {
  return {
    type: 'search',
    target: { mode: 'id', id: '' },
    whereLanguage: 'sql',
  };
}

function noneOnClick(): TableOnClick {
  return { type: 'none' };
}

/**
 * Fields shared by the `dashboard` and `search` onClick variants. Preserved
 * across mode toggles so users don't lose a half-written WHERE template or
 * their filter rows when experimenting with destinations.
 */
type SharedTemplateFields = Pick<
  Extract<TableOnClick, { type: 'dashboard' }>,
  'whereTemplate' | 'whereLanguage' | 'filterValueTemplates'
>;

function carryAcrossModes(
  from: TableOnClick | undefined,
): SharedTemplateFields {
  if (!from || from.type === 'none') return {};
  const out: SharedTemplateFields = {};
  if (from.whereTemplate !== undefined) out.whereTemplate = from.whereTemplate;
  if (from.whereLanguage !== undefined) out.whereLanguage = from.whereLanguage;
  if (from.filterValueTemplates !== undefined) {
    out.filterValueTemplates = from.filterValueTemplates;
  }
  return out;
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
                if (next === 'none') {
                  setValue('onClick', noneOnClick());
                  return;
                }
                const base =
                  next === 'dashboard'
                    ? emptyDashboardOnClick()
                    : emptySearchOnClick();
                setValue('onClick', {
                  ...base,
                  ...carryAcrossModes(onClickValue),
                });
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
    return (
      <DashboardOnClickFields
        onClick={onClick}
        setValue={setValue}
        control={control}
      />
    );
  }

  if (onClick.type === 'search') {
    return (
      <SearchOnClickFields
        onClick={onClick}
        setValue={setValue}
        control={control}
      />
    );
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
  control,
}: {
  onClick: Extract<TableOnClick, { type: 'dashboard' }>;
  setValue: (name: 'onClick', value: TableOnClick) => void;
  control: Control<DrawerFormValues>;
}) {
  const { data: dashboards } = useDashboards();

  const dashboardOptions = useMemo(
    () => (dashboards ?? []).map(d => ({ value: d.id, label: d.name })),
    [dashboards],
  );

  const mode = onClick.target.mode;

  // Seed the filter list with the selected dashboard's declared filter
  // expressions (value templates left blank) the first time a user picks
  // a specific dashboard while the current list is "blank" — i.e. empty, or
  // every entry has no template value filled in yet. The ref tracks the
  // last dashboard we've handled so clearing rows or switching away and
  // back doesn't silently re-populate on top of user intent.
  const seededForDashboardRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const dashboardId =
      onClick.target.mode === 'id' ? onClick.target.id : undefined;
    if (!dashboardId) return;
    if (seededForDashboardRef.current === dashboardId) return;
    const target = (dashboards ?? []).find(d => d.id === dashboardId);
    if (!target) return;
    seededForDashboardRef.current = dashboardId;
    const targetFilters = target.filters ?? [];
    if (targetFilters.length === 0) return;
    const currentEntries = onClick.filterValueTemplates ?? [];
    const allTemplatesBlank = currentEntries.every(e => !e.template);
    if (!allTemplatesBlank) return; // preserve anything the user typed
    setValue('onClick', {
      ...onClick,
      filterValueTemplates: targetFilters.map(f => ({
        filter: f.expression,
        template: '',
      })),
    });
  }, [onClick, dashboards, setValue]);

  return (
    <Stack gap="xs">
      <SegmentedControl
        data={[
          { label: 'By Dashboard', value: 'id' },
          { label: 'By Name (templated)', value: 'template' },
        ]}
        value={mode}
        onChange={next => {
          if (next === 'id') {
            setValue('onClick', {
              ...onClick,
              target: { mode: 'id', id: '' },
            });
          } else {
            setValue('onClick', {
              ...onClick,
              target: { mode: 'template', template: '' },
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
          value={onClick.target.mode === 'id' ? onClick.target.id : ''}
          onChange={next => {
            setValue('onClick', {
              ...onClick,
              target: { mode: 'id', id: next ?? '' },
            });
          }}
        />
      )}

      {mode === 'template' && (
        <TextInput
          label="Target dashboard name (Handlebars)"
          description="Rendered per row. Target name must match exactly one dashboard on your team."
          placeholder="{{ServiceName}} Errors"
          value={
            onClick.target.mode === 'template' ? onClick.target.template : ''
          }
          onChange={e => {
            setValue('onClick', {
              ...onClick,
              target: {
                mode: 'template',
                template: e.currentTarget.value,
              },
            });
          }}
        />
      )}

      <Box>
        <Text size="sm" fw={500} mb={4}>
          Global WHERE template (optional)
        </Text>
        <SearchWhereInput
          control={control}
          name="onClick.whereTemplate"
          languageName="onClick.whereLanguage"
          showLabel={false}
          allowMultiline
          sqlPlaceholder="ServiceName = '{{ServiceName}}'"
          lucenePlaceholder="ServiceName:{{ServiceName}}"
        />
      </Box>

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
  control,
}: {
  onClick: Extract<TableOnClick, { type: 'search' }>;
  setValue: (name: 'onClick', value: TableOnClick) => void;
  control: Control<DrawerFormValues>;
}) {
  const { data: sources } = useSources();
  const sourceOptions = useMemo(
    () => (sources ?? []).map(s => ({ value: s.id, label: s.name })),
    [sources],
  );

  const mode = onClick.target.mode;

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
              target: { mode: 'id', id: '' },
            });
          } else {
            setValue('onClick', {
              ...onClick,
              target: { mode: 'template', template: '' },
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
          value={onClick.target.mode === 'id' ? onClick.target.id : ''}
          onChange={next => {
            setValue('onClick', {
              ...onClick,
              target: { mode: 'id', id: next ?? '' },
            });
          }}
        />
      )}

      {mode === 'template' && (
        <TextInput
          label="Source template"
          description="Resolves to a source id or case-insensitive source name."
          placeholder="{{SourceName}}"
          value={
            onClick.target.mode === 'template' ? onClick.target.template : ''
          }
          onChange={e => {
            setValue('onClick', {
              ...onClick,
              target: {
                mode: 'template',
                template: e.currentTarget.value,
              },
            });
          }}
        />
      )}

      <Box>
        <Text size="sm" fw={500} mb={4}>
          WHERE template
        </Text>
        <SearchWhereInput
          control={control}
          name="onClick.whereTemplate"
          languageName="onClick.whereLanguage"
          showLabel={false}
          allowMultiline
          sqlPlaceholder="ServiceName = '{{ServiceName}}'"
          lucenePlaceholder="ServiceName:{{ServiceName}}"
        />
      </Box>

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
