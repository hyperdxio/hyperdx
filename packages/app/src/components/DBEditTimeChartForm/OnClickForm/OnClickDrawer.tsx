import { useCallback, useEffect, useMemo } from 'react';
import { Control, Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { OnClick, OnClickSchema } from '@hyperdx/common-utils/dist/types';
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

import { TextInputControlled } from '@/components/InputControlled';
import SearchWhereInput from '@/components/SearchInput/SearchWhereInput';

import { emptySearchOnClick } from './utils';

const DrawerSchema = z.object({ onClick: OnClickSchema.nullish() });

type DrawerFormValues = z.infer<typeof DrawerSchema>;
type DrawerControl = Control<DrawerFormValues>;

const TEMPLATE_HELP_TEXT = `Templates can reference column values from the clicked row using {{columnName}}.`;

function SearchOnClickFields({ control }: { control: DrawerControl }) {
  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        {TEMPLATE_HELP_TEXT}
      </Text>
      <TextInputControlled
        name="onClick.target.template"
        control={control}
        label="Source (template)"
        placeholder="Source name or template matching a source name"
        data-testid="onclick-source-template-input"
      />
      <Box>
        <Text size="sm" fw={500} mb={4}>
          WHERE (template)
        </Text>
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
