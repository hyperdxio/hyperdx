import { useCallback, useEffect, useMemo } from 'react';
import { Control, Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { validateOnClickSearch } from '@hyperdx/common-utils/dist/core/linkUrlBuilder';
import { OnClick, OnClickSchema } from '@hyperdx/common-utils/dist/types';
import {
  Box,
  Button,
  Divider,
  Drawer,
  Group,
  InputLabel,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconHelpCircle } from '@tabler/icons-react';

import { TextInputControlled } from '@/components/InputControlled';
import SearchWhereInput from '@/components/SearchInput/SearchWhereInput';

import { emptySearchOnClick } from './utils';

const DrawerSchema = z.object({ onClick: OnClickSchema.nullish() });

type DrawerFormValues = z.infer<typeof DrawerSchema>;
type DrawerControl = Control<DrawerFormValues>;

const TEMPLATE_HELP_TEXT = `Templates can reference column values from the clicked row using {{columnName}}.`;

function InputLabelWithTooltip({
  text,
  tooltip,
}: {
  text: string;
  tooltip: string;
}) {
  return (
    <Group gap="xs" align="center" mb={4}>
      <InputLabel mb={0}>{text}</InputLabel>
      <Tooltip label={tooltip}>
        <IconHelpCircle size={16} className="cursor-pointer" />
      </Tooltip>
    </Group>
  );
}

function SearchOnClickFields({ control }: { control: DrawerControl }) {
  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        {TEMPLATE_HELP_TEXT}
      </Text>
      <TextInputControlled
        name="onClick.target.template"
        control={control}
        label={
          <InputLabelWithTooltip
            text="Source"
            tooltip="Handlebars template that is matched by name against available Log and Trace sources"
          />
        }
        placeholder="e.g. Logs or Logs-{{Environment}}"
        data-testid="onclick-source-template-input"
      />
      <Box>
        <InputLabelWithTooltip
          text="WHERE"
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

function ModeFields({ control }: { control: DrawerControl }) {
  const onClick = useWatch({ control, name: 'onClick' });

  if (onClick?.type === 'search') {
    return <SearchOnClickFields control={control} />;
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
      try {
        if (values.onClick?.type === 'search') {
          validateOnClickSearch(values.onClick);
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
              ]}
              value={onClickValue?.type ?? 'default'}
              onChange={value => {
                const formValue =
                  value === 'search' ? emptySearchOnClick() : null;
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
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={applyChanges}
            data-testid="onclick-apply-button"
          >
            Apply
          </Button>
        </Group>
      </Stack>
    </Drawer>
  );
}
