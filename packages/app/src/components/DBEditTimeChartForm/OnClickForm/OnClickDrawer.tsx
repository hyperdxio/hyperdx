import { useCallback, useEffect, useMemo } from 'react';
import { Trans } from 'next-i18next/pages';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { validateOnClickTemplate } from '@hyperdx/common-utils/dist/core/linkUrlBuilder';
import { isSearchableSource, OnClick } from '@hyperdx/common-utils/dist/types';
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

function DashboardOnClickFields({ control }: { control: DrawerControl }) {
  const { data: dashboards } = useDashboards();
  const dashboardOptions = useMemo(() => {
    return dashboards?.map(dashboard => ({
      label: dashboard.name,
      value: dashboard.id,
    }));
  }, [dashboards]);

  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        {TEMPLATE_HELP_TEXT}
      </Text>

      <OnClickTargetInputControlled
        control={control}
        options={dashboardOptions}
        objectType="dashboard"
      />

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

function ModeFields({ control }: { control: DrawerControl }) {
  const onClick = useWatch({ control, name: 'onClick' });

  if (onClick?.type === 'search') {
    return <SearchOnClickFields control={control} />;
  } else if (onClick?.type === 'dashboard') {
    return <DashboardOnClickFields control={control} />;
  }

  return (
    <Text size="sm" c="dimmed">
      <Trans>
        Clicking a row opens the search page, filtered by the row's group-by
        column values and selected time range.
      </Trans>
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
          <Trans>
            Configure the action taken when clicking on a table row.
          </Trans>
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

        <ModeFields control={control} />

        <Divider />
        <Group justify="space-between">
          <Button variant="subtle" onClick={handleClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            variant="primary"
            onClick={applyChanges}
            disabled={isTargetMissing}
            data-testid="onclick-apply-button"
          >
            <Trans>Apply</Trans>
          </Button>
        </Group>
      </Stack>
    </Drawer>
  );
}
