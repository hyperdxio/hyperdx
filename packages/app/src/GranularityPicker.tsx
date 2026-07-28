import { memo } from 'react';
import { useController, UseControllerProps } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Granularity } from '@hyperdx/common-utils/dist/core/utils';
import { Select } from '@mantine/core';

export function GranularityPicker({
  value,
  onChange,
  disabled,
}: {
  value: Granularity | 'auto' | undefined;
  onChange: (granularity: Granularity | 'auto' | undefined) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation('charts');
  return (
    <Select
      disabled={disabled}
      data-testid="granularity-picker"
      data={[
        {
          value: 'auto' as const,
          label: t('granularity.auto'),
        },
        {
          value: Granularity.ThirtySecond,
          label: t('granularity.thirtySecond'),
        },
        {
          value: Granularity.OneMinute,
          label: t('granularity.oneMinute'),
        },
        {
          value: Granularity.FiveMinute,
          label: t('granularity.fiveMinute'),
        },
        {
          value: Granularity.TenMinute,
          label: t('granularity.tenMinute'),
        },
        {
          value: Granularity.FifteenMinute,
          label: t('granularity.fifteenMinute'),
        },
        {
          value: Granularity.ThirtyMinute,
          label: t('granularity.thirtyMinute'),
        },
        {
          value: Granularity.OneHour,
          label: t('granularity.oneHour'),
        },
        {
          value: Granularity.TwelveHour,
          label: t('granularity.twelveHour'),
        },
        {
          value: Granularity.OneDay,
          label: t('granularity.oneDay'),
        },
        {
          value: Granularity.SevenDay,
          label: t('granularity.sevenDay'),
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
