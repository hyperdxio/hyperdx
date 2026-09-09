import { memo } from 'react';
import { useController, UseControllerProps } from 'react-hook-form';
import { Granularity } from '@hyperdx/common-utils/dist/core/utils';
import { Select } from '@mantine/core';

export function GranularityPicker({
  value,
  onChange,
  disabled,
  label,
  size,
}: {
  value: Granularity | 'auto' | undefined;
  onChange: (granularity: Granularity | 'auto' | undefined) => void;
  disabled?: boolean;
  label?: string;
  size?: 'xs' | 'sm';
}) {
  return (
    <Select
      disabled={disabled}
      label={label}
      size={size}
      data-testid="granularity-picker"
      data={[
        {
          value: 'auto' as const,
          label: 'Auto granularity',
        },
        {
          value: Granularity.ThirtySecond,
          label: '30 seconds',
        },
        {
          value: Granularity.OneMinute,
          label: '1 minute',
        },
        {
          value: Granularity.FiveMinute,
          label: '5 minutes',
        },
        {
          value: Granularity.TenMinute,
          label: '10 minutes',
        },
        {
          value: Granularity.FifteenMinute,
          label: '15 minutes',
        },
        {
          value: Granularity.ThirtyMinute,
          label: '30 minutes',
        },
        {
          value: Granularity.OneHour,
          label: '1 hour',
        },
        {
          value: Granularity.TwelveHour,
          label: '12 hours',
        },
        {
          value: Granularity.OneDay,
          label: '1 day',
        },
        {
          value: Granularity.SevenDay,
          label: '7 days',
        },
      ]}
      onChange={v =>
        onChange((v ?? undefined) as Granularity | 'auto' | undefined)
      }
      value={value}
    />
  );
}

function GranularityPickerControlledComponent(props: UseControllerProps<any>) {
  const { field } = useController(props);

  return <GranularityPicker value={field.value} onChange={field.onChange} />;
}

export const GranularityPickerControlled = memo(
  GranularityPickerControlledComponent,
);
