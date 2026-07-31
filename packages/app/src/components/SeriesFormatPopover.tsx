import { ReactNode, useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { NumberFormat } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Divider,
  Popover,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';

import {
  DEFAULT_NUMBER_FORMAT,
  FORMAT_ICONS,
  NumberFormatForm,
} from './NumberFormat';

type FormState = { numberFormat?: NumberFormat };

interface SeriesFormatPopoverProps {
  numberFormat?: NumberFormat;
  onChange: (format: FormState) => void;
}

/**
 * Per-series display-format editor opened from the format affordance on the
 * series row. Renders as a popover anchored to its trigger and writes live to
 * the tile draft, so there is no Apply button.
 */
export default function SeriesFormatPopover({
  numberFormat: initialNumberFormat,
  onChange,
}: SeriesFormatPopoverProps) {
  const [opened, setOpened] = useState(false);

  const appliedDefaults = useMemo<FormState>(
    () => ({ numberFormat: initialNumberFormat }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once on mount
    [],
  );

  const { control, setValue, getValues, formState } = useForm<FormState>({
    defaultValues: appliedDefaults,
  });

  const numberFormat = useWatch({ control, name: 'numberFormat' });
  const isUsingCustomFormat = numberFormat != null;

  const isDirty = Object.keys(formState.dirtyFields).length > 0;
  useEffect(() => {
    if (!isDirty) return;
    const handle = setTimeout(() => {
      onChange({ numberFormat: getValues('numberFormat') });
    }, 300);
    return () => clearTimeout(handle);
  }, [numberFormat, isDirty, getValues, onChange]);

  const triggerIcon: ReactNode =
    FORMAT_ICONS[initialNumberFormat?.output ?? 'number'];

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      shadow="md"
      withinPortal
      closeOnEscape
      closeOnClickOutside
      trapFocus
    >
      <Popover.Target>
        <Tooltip label="Edit series display format">
          <ActionIcon
            variant="subtle"
            color="gray"
            size="xs"
            onClick={() => setOpened(o => !o)}
            aria-label="Edit series display format"
            aria-haspopup="dialog"
            aria-expanded={opened}
          >
            {triggerIcon}
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown p="sm" style={{ width: 340 }}>
        <Stack data-testid="series-format-popover">
          <SegmentedControl
            size="xs"
            value={isUsingCustomFormat ? 'format' : 'inherit'}
            onChange={value => {
              if (value === 'inherit') {
                setValue('numberFormat', undefined, { shouldDirty: true });
              } else if (numberFormat) {
                setValue('numberFormat', numberFormat, { shouldDirty: true });
              } else {
                setValue('numberFormat', DEFAULT_NUMBER_FORMAT, {
                  shouldDirty: true,
                });
              }
            }}
            data={[
              { label: 'Inherit', value: 'inherit' },
              { label: 'Custom', value: 'format' },
            ]}
          />
          {isUsingCustomFormat ? (
            <>
              <NumberFormatForm control={control} setValue={setValue} />
              <Divider />
            </>
          ) : (
            <Text size="xs">
              Inherit display settings from chart&apos;s display settings.
            </Text>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
