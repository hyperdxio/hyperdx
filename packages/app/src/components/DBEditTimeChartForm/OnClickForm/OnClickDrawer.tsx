import { useCallback, useEffect, useMemo } from 'react';
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
import {
  Box,
  Button,
  Divider,
  Drawer,
  Group,
  SegmentedControl,
  Stack,
  Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';

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
  }

  return (
    <Text size="sm" c="dimmed">
      Clicking a row opens the search page, filtered by the row&apos;s group-by
      column values and selected time range.
    </Text>
  );
}

type OnClickDrawerProps = {
  opened: boolean;
  value: OnClick | undefined;
  onChange: (value: OnClick | undefined) => void;
  onClose: () => void;
};

export default function OnClickDrawer({
  opened,
  value,
  onChange,
  onClose,
}: OnClickDrawerProps) {
  const appliedDefaults: DrawerFormValues = useMemo(
    () => ({ onClick: value }),
    [value],
  );

  const { control, handleSubmit, reset, setValue, getValues } =
    useForm<DrawerFormValues>({
      defaultValues: appliedDefaults,
      resolver: zodResolver(DrawerSchema),
    });

  // Whenever the drawer is (re)opened with a fresh value from the parent,
  // sync the local form to that value. Reopening after a cancel should not
  // resurrect abandoned edits.
  useEffect(() => {
    if (opened) reset(appliedDefaults);
  }, [opened, appliedDefaults, reset]);

  const { data: dashboards } = useDashboards();
  const { data: sources } = useSources();
  const watchedOnClick = useWatch({ control, name: 'onClick' });

  const isTargetMissing = useMemo(() => {
    if (!watchedOnClick || watchedOnClick.target.mode !== 'id') return false;

    const validTargetIds =
      watchedOnClick.type === 'dashboard'
        ? dashboards?.map(d => d.id)
        : sources?.filter(isSearchableSource).map(s => s.id);

    if (!validTargetIds) return false;
    return !validTargetIds.includes(watchedOnClick.target.id);
  }, [watchedOnClick, dashboards, sources]);

  const applyChanges = useCallback(() => {
    handleSubmit(values => {
      try {
        if (values.onClick) {
          validateOnClickTemplate(values.onClick);
        }
      } catch (err) {
        notifications.show({
          title: 'Invalid template',
          message: err instanceof Error ? err.message : 'Unknown error',
          color: 'red',
        });
        return;
      }

      onChange(values.onClick ?? undefined);
      onClose();
    })();
  }, [handleSubmit, onChange, onClose]);

  const handleClose = useCallback(() => {
    reset(appliedDefaults);
    onClose();
  }, [reset, appliedDefaults, onClose]);

  return (
    <Drawer
      title="Row Click Action"
      opened={opened}
      onClose={handleClose}
      position="right"
      size="lg"
    >
      <Stack data-testid="onclick-drawer">
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
              ]}
              value={onClickValue?.type ?? 'default'}
              onChange={value => {
                const formValue =
                  value === 'search'
                    ? emptySearchOnClick()
                    : value === 'dashboard'
                      ? emptyDashboardOnClick()
                      : null;
                setValue('onClick', formValue);
              }}
              fullWidth
            />
          )}
        />

        <ModeFields
          control={control}
          setValue={setValue}
          getValues={getValues}
        />

        <Divider />
        <Group justify="space-between">
          <Button variant="subtle" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={applyChanges}
            disabled={isTargetMissing}
            data-testid="onclick-apply-button"
          >
            Apply
          </Button>
        </Group>
      </Stack>
    </Drawer>
  );
}
