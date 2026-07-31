import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Controller,
  useForm,
  UseFormGetValues,
  UseFormSetValue,
  useWatch,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { validateOnClickTemplate } from '@hyperdx/common-utils/dist/core/linkUrlBuilder';
import {
  isSearchableSource,
  OnClick,
  OnClickTarget,
} from '@hyperdx/common-utils/dist/types';
import { Alert, Box, SegmentedControl, Stack, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';

import { TextInputControlled } from '@/components/InputControlled';
import { InputLabelWithTooltip } from '@/components/InputLabelWithTooltip';
import SearchWhereInput from '@/components/SearchInput/SearchWhereInput';
import { useDashboards } from '@/dashboard';
import { useSources } from '@/source';

import { FilterTemplateList } from './FilterTemplateList';
import { OnClickTargetInputControlled } from './OnClickTargetInputControlled';
import {
  DrawerControl,
  DrawerFormValues,
  DrawerSchema,
  emptyDashboardOnClick,
  emptyExternalOnClick,
  emptySearchOnClick,
} from './utils';

const TEMPLATE_HELP_TEXT = `Templates can reference column values from the clicked row using {{columnName}}.`;

function SearchOnClickFields({ control }: { control: DrawerControl }) {
  const { data: sources } = useSources();

  const sourceOptions = useMemo(() => {
    return sources?.filter(isSearchableSource).map(source => ({
      label: source.name,
      value: source.id,
    }));
  }, [sources]);

  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        {TEMPLATE_HELP_TEXT}
      </Text>

      <OnClickTargetInputControlled
        control={control}
        options={sourceOptions}
        objectType="source"
      />

      <FilterTemplateList control={control} />

      <Box>
        <InputLabelWithTooltip
          label="WHERE"
          tooltip="Handlebars template that determines the WHERE condition passed to the search page"
        />
        <SearchWhereInput
          control={control}
          name="onClick.whereTemplate"
          languageName="onClick.whereLanguage"
          allowMultiline
          showLabel={false}
          sqlPlaceholder="ServiceName = '{{ServiceName}}'"
          lucenePlaceholder="ServiceName:{{ServiceName}}"
        />
      </Box>
    </Stack>
  );
}

function DashboardOnClickFields({
  control,
  setValue,
  getValues,
}: {
  control: DrawerControl;
  setValue: UseFormSetValue<DrawerFormValues>;
  getValues: UseFormGetValues<DrawerFormValues>;
}) {
  const { data: dashboards } = useDashboards();
  const dashboardOptions = useMemo(() => {
    return dashboards?.map(dashboard => ({
      label: dashboard.name,
      value: dashboard.id,
    }));
  }, [dashboards]);

  // When the target dashboard changes, create empty filter templates
  // for each of the target dashboard's existing filters
  // (if the current templates are all empty).
  const handleTargetChange = useCallback(
    (target: OnClickTarget) => {
      if (target.mode !== 'id') return;
      const selected = dashboards?.find(d => d.id === target.id);
      const dashboardFilters = selected?.filters ?? [];

      const currentFilters = getValues('onClick.filters') ?? [];
      const allTemplatesEmpty = currentFilters.every(f => f.template === '');
      if (!allTemplatesEmpty) return;

      setValue(
        'onClick.filters',
        dashboardFilters.map(f => ({
          kind: 'expressionTemplate' as const,
          expression: f.expression,
          template: '',
        })),
      );
    },
    [dashboards, setValue, getValues],
  );

  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        {TEMPLATE_HELP_TEXT}
      </Text>

      <OnClickTargetInputControlled
        control={control}
        options={dashboardOptions}
        objectType="dashboard"
        onTargetChange={handleTargetChange}
      />

      <FilterTemplateList control={control} />

      <Box>
        <InputLabelWithTooltip
          label="WHERE"
          tooltip="Handlebars template that determines the global WHERE condition passed to the dashboard"
        />
        <SearchWhereInput
          control={control}
          name="onClick.whereTemplate"
          languageName="onClick.whereLanguage"
          allowMultiline
          showLabel={false}
          sqlPlaceholder="ServiceName = '{{ServiceName}}'"
          lucenePlaceholder="ServiceName:{{ServiceName}}"
        />
      </Box>
    </Stack>
  );
}

function ExternalOnClickFields({ control }: { control: DrawerControl }) {
  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        {TEMPLATE_HELP_TEXT} The rendered value must be an absolute http(s) URL.
        <br />
        <br />
        <b>Caution:</b> this may navigate to an external site and include
        information from your data. Make sure the template does not contain any
        sensitive information, and that the external site is trusted.
      </Text>

      <Box>
        <InputLabelWithTooltip
          label="URL"
          tooltip="Handlebars template that resolves to an external URL. It is opened in a new tab when a row is clicked."
        />
        <TextInputControlled
          control={control}
          name="onClick.urlTemplate"
          placeholder="https://example.com/abc?service={{ServiceName}}"
          data-testid="onclick-external-url-input"
        />
      </Box>
    </Stack>
  );
}

function ModeFields({
  control,
  setValue,
  getValues,
}: {
  control: DrawerControl;
  setValue: UseFormSetValue<DrawerFormValues>;
  getValues: UseFormGetValues<DrawerFormValues>;
}) {
  const onClick = useWatch({ control, name: 'onClick' });

  if (onClick?.type === 'search') {
    return <SearchOnClickFields control={control} />;
  } else if (onClick?.type === 'dashboard') {
    return (
      <DashboardOnClickFields
        control={control}
        setValue={setValue}
        getValues={getValues}
      />
    );
  } else if (onClick?.type === 'external') {
    return <ExternalOnClickFields control={control} />;
  }

  return (
    <Text size="sm" c="dimmed">
      Clicking a row opens the search page, filtered by the row&apos;s group-by
      column values and selected time range.
    </Text>
  );
}

type OnClickSectionProps = {
  value: OnClick | undefined;
  onChange: (value: OnClick | undefined) => void;
};

/**
 * Row Click Action editor rendered as a docked rail section. Edits write live
 * to the tile draft (the tile's Save/Cancel is the single commit point), so
 * there is no Apply button. An invalid template is surfaced inline and simply
 * not written until it becomes valid again.
 */
export default function OnClickSection({
  value,
  onChange,
}: OnClickSectionProps) {
  const appliedDefaults: DrawerFormValues = useMemo(
    () => ({ onClick: value }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once on mount
    [],
  );

  const { control, setValue, getValues, formState } = useForm<DrawerFormValues>(
    {
      defaultValues: appliedDefaults,
      resolver: zodResolver(DrawerSchema),
    },
  );

  const { data: dashboards } = useDashboards();
  const { data: sources } = useSources();
  const watchedOnClick = useWatch({ control, name: 'onClick' });

  const isTargetMissing = useMemo(() => {
    if (
      !watchedOnClick ||
      watchedOnClick.type === 'external' ||
      watchedOnClick.target.mode !== 'id'
    ) {
      return false;
    }

    const validTargetIds =
      watchedOnClick.type === 'dashboard'
        ? dashboards?.map(d => d.id)
        : sources?.filter(isSearchableSource).map(s => s.id);

    if (!validTargetIds) return false;
    return !validTargetIds.includes(watchedOnClick.target.id);
  }, [watchedOnClick, dashboards, sources]);

  const [templateError, setTemplateError] = useState<string | null>(null);

  // Autosave: on each edit, validate the template and (if valid and the target
  // resolves) write the value through to the tile draft. Invalid states are
  // shown inline and held back until they become valid again.
  const isDirty = Object.keys(formState.dirtyFields).length > 0;
  useEffect(() => {
    if (!isDirty) return;
    const handle = setTimeout(() => {
      const next = getValues('onClick') ?? undefined;
      if (next) {
        try {
          validateOnClickTemplate(next);
        } catch (err) {
          setTemplateError(
            err instanceof Error ? err.message : 'Invalid template',
          );
          return;
        }
      }
      setTemplateError(null);
      if (isTargetMissing) return;
      onChange(next);
    }, 300);
    return () => clearTimeout(handle);
  }, [watchedOnClick, isDirty, isTargetMissing, getValues, onChange]);

  return (
    <Stack data-testid="onclick-section">
      <Text size="xs" c="dimmed">
        Configure the action taken when clicking on a table row.
      </Text>

      <Controller
        control={control}
        name="onClick"
        render={({ field: { value: onClickValue } }) => (
          <SegmentedControl
            data-testid="onclick-mode-segmented"
            data={[
              { label: 'Default', value: 'default' },
              { label: 'Search', value: 'search' },
              { label: 'Dashboard', value: 'dashboard' },
              { label: 'External', value: 'external' },
            ]}
            value={onClickValue?.type ?? 'default'}
            onChange={value => {
              const formValue =
                value === 'search'
                  ? emptySearchOnClick()
                  : value === 'dashboard'
                    ? emptyDashboardOnClick()
                    : value === 'external'
                      ? emptyExternalOnClick()
                      : null;
              setValue('onClick', formValue, { shouldDirty: true });
            }}
            fullWidth
          />
        )}
      />

      <ModeFields control={control} setValue={setValue} getValues={getValues} />

      {(isTargetMissing || templateError) && (
        <Alert
          variant="warning"
          p="xs"
          icon={<IconAlertTriangle size={16} />}
          data-testid="onclick-error"
        >
          <Text size="xs" m={0}>
            {templateError ??
              'The selected target no longer exists. Pick another to save this action.'}
          </Text>
        </Alert>
      )}
    </Stack>
  );
}
