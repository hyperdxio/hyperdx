import { useEffect, useState } from 'react';
import {
  Control,
  Controller,
  FieldPath,
  FieldValues,
  PathValue,
  UseFormSetValue,
  useWatch,
} from 'react-hook-form';
import { NumberInput } from 'react-hook-form-mantine';
import { Anchor, Button, Group, Stack, Text, Tooltip } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { IconHelpCircle, IconSettings } from '@tabler/icons-react';

import { parseScheduleStartAtValue } from '@/utils/alerts';

const DATE_TIME_INPUT_FORMAT = 'YYYY-MM-DD HH:mm:ss';

type AlertScheduleFieldsProps<T extends FieldValues> = {
  control: Control<T>;
  setValue: UseFormSetValue<T>;
  scheduleOffsetName: FieldPath<T>;
  scheduleStartAtName: FieldPath<T>;
  scheduleOffsetMinutes: number | null | undefined;
  maxScheduleOffsetMinutes: number;
  offsetWindowLabel: string;
};

export function AlertScheduleFields<T extends FieldValues>({
  control,
  setValue,
  scheduleOffsetName,
  scheduleStartAtName,
  scheduleOffsetMinutes,
  maxScheduleOffsetMinutes,
  offsetWindowLabel,
}: AlertScheduleFieldsProps<T>) {
  const showScheduleOffsetInput = maxScheduleOffsetMinutes > 0;
  const scheduleStartAtValue = useWatch({
    control,
    name: scheduleStartAtName,
  }) as string | null | undefined;
  const hasScheduleStartAtAnchor = scheduleStartAtValue != null;
  const hasAdvancedScheduleValues =
    (scheduleOffsetMinutes ?? 0) > 0 || hasScheduleStartAtAnchor;
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(
    hasAdvancedScheduleValues,
  );

  useEffect(() => {
    const normalizedOffset = scheduleOffsetMinutes ?? 0;
    if (!showScheduleOffsetInput && normalizedOffset !== 0) {
      setValue(scheduleOffsetName, 0 as PathValue<T, FieldPath<T>>, {
        shouldValidate: true,
      });
      return;
    }
    if (hasScheduleStartAtAnchor && normalizedOffset > 0) {
      setValue(scheduleOffsetName, 0 as PathValue<T, FieldPath<T>>, {
        shouldValidate: true,
      });
    }
  }, [
    hasScheduleStartAtAnchor,
    scheduleOffsetMinutes,
    scheduleOffsetName,
    setValue,
    showScheduleOffsetInput,
  ]);

  return (
    <Stack gap="xs" mt="xs">
      {!showAdvancedSettings ? (
        <Anchor
          underline="always"
          size="xs"
          onClick={() => setShowAdvancedSettings(true)}
          data-testid="alert-advanced-settings-toggle"
        >
          <Group gap="xs">
            <IconSettings size={14} />
            Advanced Settings
          </Group>
        </Anchor>
      ) : (
        <Button
          size="xs"
          variant="subtle"
          w="fit-content"
          onClick={() => setShowAdvancedSettings(false)}
          data-testid="alert-advanced-settings-toggle"
        >
          Hide Advanced Settings
        </Button>
      )}
      {showAdvancedSettings && (
        <Stack gap="sm" data-testid="alert-advanced-settings-panel">
          {showScheduleOffsetInput && (
            <Stack gap={4}>
              <Group gap="xs">
                <Text size="sm" opacity={0.7}>
                  Start offset (min)
                </Text>
                <Tooltip
                  label="Shifts each alert window forward by a fixed number of minutes inside the selected interval. For example, a 15 minute alert with offset 5 runs on windows starting at :05, :20, :35, and :50."
                  multiline
                  maw={360}
                >
                  <IconHelpCircle size={16} />
                </Tooltip>
              </Group>
              <Text size="xs" opacity={0.6}>
                Use this to align recurring windows to a fixed offset{' '}
                {offsetWindowLabel}.
              </Text>
              <Group gap="xs">
                <NumberInput
                  min={0}
                  max={maxScheduleOffsetMinutes}
                  step={1}
                  size="xs"
                  w={100}
                  control={control}
                  name={scheduleOffsetName}
                  disabled={hasScheduleStartAtAnchor}
                />
                <Text size="sm" opacity={0.7}>
                  {offsetWindowLabel}
                </Text>
              </Group>
              {hasScheduleStartAtAnchor && (
                <Text size="xs" opacity={0.6}>
                  Start offset is ignored while an anchor start time is set.
                </Text>
              )}
            </Stack>
          )}
          <Stack gap={4}>
            <Group gap="xs">
              <Text size="sm" opacity={0.7}>
                Anchor start time
              </Text>
              <Tooltip
                label="Anchors the recurring alert schedule to an exact date and time. Future checks repeat on the alert interval from this anchor, which helps match external systems with fixed schedules."
                multiline
                maw={360}
              >
                <IconHelpCircle size={16} />
              </Tooltip>
            </Group>
            <Text size="xs" opacity={0.6}>
              Use an exact start time to repeat isolated windows on the selected
              interval. Displayed in local time, stored as UTC.
            </Text>
            <Controller
              control={control}
              name={scheduleStartAtName}
              render={({ field, fieldState: { error } }) => (
                <DateTimePicker
                  size="xs"
                  w={260}
                  placeholder={DATE_TIME_INPUT_FORMAT}
                  valueFormat={DATE_TIME_INPUT_FORMAT}
                  clearable
                  dropdownType="popover"
                  popoverProps={{ withinPortal: true, zIndex: 10050 }}
                  value={parseScheduleStartAtValue(
                    field.value as string | null | undefined,
                  )}
                  onChange={value =>
                    field.onChange(value?.toISOString() ?? null)
                  }
                  error={error?.message}
                />
              )}
            />
          </Stack>
        </Stack>
      )}
    </Stack>
  );
}
