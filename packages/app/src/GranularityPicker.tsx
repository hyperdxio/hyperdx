import { memo } from 'react';
import { useController, UseControllerProps } from 'react-hook-form';
import { Select } from '@mantine/core';

import { Granularity } from './ChartUtils';

export default function GranularityPicker({
  value,
  onChange,
  disabled,
}: {
  value: Granularity | 'auto' | undefined;
  onChange: (granularity: Granularity | 'auto' | undefined) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      disabled={disabled}
      data={[
        {
          value: 'auto' as const,
          label: 'Auto Granularity',
        },
        {
          value: Granularity.ThirtySecond,
          label: '30 Seconds Granularity',
        },
        {
          value: Granularity.OneMinute,
          label: '1 Minute Granularity',
        },
        {
          value: Granularity.FiveMinute,
          label: '5 Minutes Granularity',
        },
        {
          value: Granularity.TenMinute,
          label: '10 Minutes Granularity',
        },
        {
          value: Granularity.ThirtyMinute,
          label: '30 Minutes Granularity',
        },
        {
          value: Granularity.OneHour,
          label: '1 Hour Granularity',
        },
        {
          value: Granularity.TwelveHour,
          label: '12 Hours Granularity',
        },
        {
          value: Granularity.OneDay,
          label: '1 Day Granularity',
        },
        {
          value: Granularity.SevenDay,
          label: '7 Day Granularity',
        },
      ]}
      onChange={v =>
        onChange((v ?? undefined) as Granularity | 'auto' | undefined)
      }
      value={value}
    />
  );
}

export function GranularityPickerControlledComponent(
  props: UseControllerProps<any>,
) {
  const {
    field,
    fieldState: { invalid, isTouched, isDirty },
    formState: { touchedFields, dirtyFields },
  } = useController(props);

  return <GranularityPicker value={field.value} onChange={field.onChange} />;
}

export const GranularityPickerControlled = memo(
  GranularityPickerControlledComponent,
);
