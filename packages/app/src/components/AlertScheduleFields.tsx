import { useEffect } from 'react';
import {
  Control,
  Controller,
  FieldPath,
  FieldValues,
  PathValue,
  UseFormSetValue,
} from 'react-hook-form';
import { NumberInput } from 'react-hook-form-mantine';
import { Group, Text } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';

import { parseScheduleStartAtValue } from '@/utils/alerts';

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

  useEffect(() => {
    if (showScheduleOffsetInput || scheduleOffsetMinutes === 0) {
      return;
    }

    setValue(scheduleOffsetName, 0 as PathValue<T, FieldPath<T>>, {
      shouldValidate: true,
    });
  }, [
    scheduleOffsetMinutes,
    scheduleOffsetName,
    setValue,
    showScheduleOffsetInput,
  ]);

  return (
    <>
      {showScheduleOffsetInput && (
        <Group gap="xs" mt="xs">
          <Text size="sm" opacity={0.7}>
            Start offset (min)
          </Text>
          <NumberInput
            min={0}
            max={maxScheduleOffsetMinutes}
            step={1}
            size="xs"
            w={100}
            control={control}
            name={scheduleOffsetName}
          />
          <Text size="sm" opacity={0.7}>
            {offsetWindowLabel}
          </Text>
        </Group>
      )}
      <Group gap="xs" mt="xs" align="start">
        <Text size="sm" opacity={0.7} mt={6}>
          Anchor start time
        </Text>
        <Controller
          control={control}
          name={scheduleStartAtName}
          render={({ field, fieldState: { error } }) => (
            <DateTimePicker
              size="xs"
              w={260}
              placeholder="Pick date and time"
              clearable
              dropdownType="popover"
              popoverProps={{ withinPortal: true, zIndex: 10050 }}
              value={parseScheduleStartAtValue(
                field.value as string | null | undefined,
              )}
              onChange={value => field.onChange(value?.toISOString() ?? null)}
              error={error?.message}
            />
          )}
        />
        <Text size="xs" opacity={0.6} mt={6}>
          Converted to UTC on save
        </Text>
      </Group>
    </>
  );
}
