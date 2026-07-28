import * as React from 'react';
import { useMemo } from 'react';
import {
  Control,
  Controller,
  UseFormSetValue,
  useWatch,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { NumberFormat, NumericUnit } from '@hyperdx/common-utils/dist/types';
import {
  Checkbox as MCheckbox,
  NativeSelect,
  Paper,
  Slider,
  Stack,
  TextInput,
} from '@mantine/core';
import {
  IconClock,
  IconCurrencyDollar,
  IconDatabase,
  IconHourglass,
  IconNumbers,
  IconPercentage,
} from '@tabler/icons-react';

import type { numberFormat as enChartsNumberFormat } from '@/i18n/locales/en/charts/numberFormat';
import { formatNumber } from '@/utils';

import { ChartConfigDisplaySettings } from './ChartDisplaySettingsDrawer';

export const FORMAT_ICONS: Record<string, React.ReactNode> = {
  number: <IconNumbers size={14} />,
  currency: <IconCurrencyDollar size={14} />,
  percent: <IconPercentage size={14} />,
  byte: <IconDatabase size={14} />,
  time: <IconClock size={14} />,
  duration: <IconHourglass size={14} />,
  data_rate: <IconDatabase size={14} />,
  throughput: <IconNumbers size={14} />,
};

const TEST_NUMBER = 1234;

export const DEFAULT_NUMBER_FORMAT: NumberFormat = {
  factor: 1,
  output: 'number' as const,
  mantissa: 2,
  thousandSeparated: true,
  average: false,
  decimalBytes: false,
};

type UnitOption = { value: NumericUnit; label: string };
type OutputOption = { value: NumberFormat['output']; label: string };
type OutputGroup = { group: string; items: OutputOption[] };

// Catalog key suffixes under `charts:numberFormat.units`, derived from the
// English catalog so a renamed unit key fails the type check here.
type UnitLabelKey = keyof (typeof enChartsNumberFormat)['units'];
type UnitEntry = { value: NumericUnit; labelKey: UnitLabelKey };

const DATA_UNITS: UnitEntry[] = [
  { value: NumericUnit.BytesIEC, labelKey: 'bytesIec' },
  { value: NumericUnit.BytesSI, labelKey: 'bytesSi' },
  { value: NumericUnit.BitsIEC, labelKey: 'bitsIec' },
  { value: NumericUnit.BitsSI, labelKey: 'bitsSi' },
  { value: NumericUnit.Kibibytes, labelKey: 'kibibytes' },
  { value: NumericUnit.Kilobytes, labelKey: 'kilobytes' },
  { value: NumericUnit.Mebibytes, labelKey: 'mebibytes' },
  { value: NumericUnit.Megabytes, labelKey: 'megabytes' },
  { value: NumericUnit.Gibibytes, labelKey: 'gibibytes' },
  { value: NumericUnit.Gigabytes, labelKey: 'gigabytes' },
  { value: NumericUnit.Tebibytes, labelKey: 'tebibytes' },
  { value: NumericUnit.Terabytes, labelKey: 'terabytes' },
  { value: NumericUnit.Pebibytes, labelKey: 'pebibytes' },
  { value: NumericUnit.Petabytes, labelKey: 'petabytes' },
];

const DATA_RATE_UNITS: UnitEntry[] = [
  { value: NumericUnit.PacketsSec, labelKey: 'packetsSec' },
  { value: NumericUnit.BytesSecIEC, labelKey: 'bytesSecIec' },
  { value: NumericUnit.BytesSecSI, labelKey: 'bytesSecSi' },
  { value: NumericUnit.BitsSecIEC, labelKey: 'bitsSecIec' },
  { value: NumericUnit.BitsSecSI, labelKey: 'bitsSecSi' },
  { value: NumericUnit.KibibytesSec, labelKey: 'kibibytesSec' },
  { value: NumericUnit.KibibitsSec, labelKey: 'kibibitsSec' },
  { value: NumericUnit.KilobytesSec, labelKey: 'kilobytesSec' },
  { value: NumericUnit.KilobitsSec, labelKey: 'kilobitsSec' },
  { value: NumericUnit.MebibytesSec, labelKey: 'mebibytesSec' },
  { value: NumericUnit.MebibitsSec, labelKey: 'mebibitsSec' },
  { value: NumericUnit.MegabytesSec, labelKey: 'megabytesSec' },
  { value: NumericUnit.MegabitsSec, labelKey: 'megabitsSec' },
  { value: NumericUnit.GibibytesSec, labelKey: 'gibibytesSec' },
  { value: NumericUnit.GibibitsSec, labelKey: 'gibibitsSec' },
  { value: NumericUnit.GigabytesSec, labelKey: 'gigabytesSec' },
  { value: NumericUnit.GigabitsSec, labelKey: 'gigabitsSec' },
  { value: NumericUnit.TebibytesSec, labelKey: 'tebibytesSec' },
  { value: NumericUnit.TebibitsSec, labelKey: 'tebibitsSec' },
  { value: NumericUnit.TerabytesSec, labelKey: 'terabytesSec' },
  { value: NumericUnit.TerabitsSec, labelKey: 'terabitsSec' },
  { value: NumericUnit.PebibytesSec, labelKey: 'pebibytesSec' },
  { value: NumericUnit.PebibitsSec, labelKey: 'pebibitsSec' },
  { value: NumericUnit.PetabytesSec, labelKey: 'petabytesSec' },
  { value: NumericUnit.PetabitsSec, labelKey: 'petabitsSec' },
];

const THROUGHPUT_UNITS: UnitEntry[] = [
  { value: NumericUnit.Cps, labelKey: 'cps' },
  { value: NumericUnit.Ops, labelKey: 'ops' },
  { value: NumericUnit.Rps, labelKey: 'rps' },
  { value: NumericUnit.ReadsSec, labelKey: 'readsSec' },
  { value: NumericUnit.Wps, labelKey: 'wps' },
  { value: NumericUnit.Iops, labelKey: 'iops' },
  { value: NumericUnit.Cpm, labelKey: 'cpm' },
  { value: NumericUnit.Opm, labelKey: 'opm' },
  { value: NumericUnit.RpmReads, labelKey: 'rpmReads' },
  { value: NumericUnit.Wpm, labelKey: 'wpm' },
];

const UNITS_BY_OUTPUT: Record<string, UnitEntry[]> = {
  byte: DATA_UNITS,
  data_rate: DATA_RATE_UNITS,
  throughput: THROUGHPUT_UNITS,
};

const DEFAULT_NUMERIC_UNIT_BY_OUTPUT: Partial<
  Record<NumberFormat['output'], NumericUnit>
> = {
  byte: NumericUnit.BytesIEC,
  data_rate: NumericUnit.BytesSecIEC,
  throughput: NumericUnit.Cps,
};

function useOutputCategoryOptions(): OutputGroup[] {
  const { t } = useTranslation('charts');

  return useMemo(
    () => [
      {
        group: t('numberFormat.groups.basic'),
        items: [
          { value: 'number', label: t('numberFormat.outputs.number') },
          { value: 'currency', label: t('numberFormat.outputs.currency') },
          { value: 'percent', label: t('numberFormat.outputs.percent') },
          { value: 'duration', label: t('numberFormat.outputs.duration') },
          { value: 'time', label: t('numberFormat.outputs.time') },
        ],
      },
      {
        group: t('numberFormat.groups.data'),
        items: [{ value: 'byte', label: t('numberFormat.outputs.byte') }],
      },
      {
        group: t('numberFormat.groups.network'),
        items: [
          { value: 'data_rate', label: t('numberFormat.outputs.dataRate') },
          { value: 'throughput', label: t('numberFormat.outputs.throughput') },
        ],
      },
    ],
    [t],
  );
}

const hasNumericUnit = (output: string) =>
  output === 'byte' || output === 'data_rate' || output === 'throughput';

export const NumberFormatForm: React.FC<{
  control: Control<Pick<ChartConfigDisplaySettings, 'numberFormat'>>;
  setValue: UseFormSetValue<Pick<ChartConfigDisplaySettings, 'numberFormat'>>;
  disclaimer?: React.ReactNode;
}> = ({ control, setValue, disclaimer }) => {
  const { t } = useTranslation('charts');
  const outputCategoryOptions = useOutputCategoryOptions();
  const format =
    useWatch({ control, name: 'numberFormat' }) ?? DEFAULT_NUMBER_FORMAT;

  const unitOptions: UnitOption[] | null = useMemo(() => {
    const units = format.output ? UNITS_BY_OUTPUT[format.output] : undefined;

    return (
      units?.map(({ value, labelKey }) => ({
        value,
        label: t(`numberFormat.units.${labelKey}`),
      })) ?? null
    );
  }, [format.output, t]);

  return (
    <>
      <Stack style={{ flex: 1 }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'nowrap',
            alignItems: 'stretch',
            justifyContent: 'stretch',
            gap: 10,
          }}
        >
          <Controller
            control={control}
            key="numberFormat.output"
            name="numberFormat.output"
            render={({ field: { onChange, ...field } }) => (
              <NativeSelect
                {...field}
                label={t('numberFormat.outputLabel')}
                leftSection={format.output && FORMAT_ICONS[format.output]}
                style={{ flex: 1 }}
                data={outputCategoryOptions}
                onChange={e => {
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
                  const newOutput = e.target.value as NumberFormat['output'];
                  onChange(newOutput);
                  setValue(
                    'numberFormat.numericUnit',
                    DEFAULT_NUMERIC_UNIT_BY_OUTPUT[newOutput] ?? undefined,
                  );
                }}
              />
            )}
          />
          {format.output === 'currency' && (
            <Controller
              control={control}
              key="numberFormat.currencySymbol"
              name="numberFormat.currencySymbol"
              render={({ field }) => (
                <TextInput
                  {...field}
                  w={80}
                  label={t('numberFormat.symbol')}
                  placeholder="$"
                />
              )}
            />
          )}
        </div>

        {unitOptions && (
          <Controller
            control={control}
            key="numberFormat.numericUnit"
            name="numberFormat.numericUnit"
            render={({ field: { value, onChange, ...field } }) => (
              <NativeSelect
                {...field}
                label={t('numberFormat.unit')}
                value={
                  value ?? DEFAULT_NUMERIC_UNIT_BY_OUTPUT[format.output ?? '']
                }
                onChange={e => onChange(e.target.value)}
                data={unitOptions}
              />
            )}
          />
        )}

        <div style={{ marginTop: -6 }}>
          <Paper p="xs" py={4}>
            <div
              style={{
                fontSize: 11,
              }}
            >
              {t('numberFormat.example')}
            </div>
            {formatNumber(TEST_NUMBER || 0, {
              ...format,
              numericUnit:
                format.numericUnit ??
                (format.output
                  ? DEFAULT_NUMERIC_UNIT_BY_OUTPUT[format.output]
                  : undefined),
            })}
          </Paper>
        </div>

        {format.output !== 'time' && format.output !== 'duration' && (
          <div>
            <div className="fs-8 mt-2 fw-bold mb-1">
              {t('numberFormat.decimals')}
            </div>
            <Controller
              control={control}
              key="numberFormat.mantissa"
              name="numberFormat.mantissa"
              render={({ field: { value, onChange } }) => (
                <Slider
                  mb="xl"
                  min={0}
                  max={10}
                  label={val => t('numberFormat.decimalsValue', { count: val })}
                  marks={[
                    { value: 0, label: '0' },
                    { value: 10, label: '10' },
                  ]}
                  value={value ?? 2}
                  onChange={onChange}
                />
              )}
            />
          </div>
        )}

        <Stack gap="xs">
          {format.output === 'byte' && !format.numericUnit ? (
            <Controller
              control={control}
              key="numberFormat.decimalBytes"
              name="numberFormat.decimalBytes"
              render={({ field: { value, onChange, ...field } }) => {
                return (
                  <MCheckbox
                    {...field}
                    size="xs"
                    label={t('numberFormat.decimalBase')}
                    description={t('numberFormat.decimalBaseDescription')}
                    checked={value}
                    onChange={onChange}
                  />
                );
              }}
            />
          ) : format.output === 'time' || format.output === 'duration' ? (
            <Controller
              control={control}
              key="numberFormat.factor"
              name="numberFormat.factor"
              render={({ field: { value, onChange, ...field } }) => {
                const options = [
                  { value: '1', label: t('numberFormat.factors.seconds') },
                  {
                    value: '0.001',
                    label: t('numberFormat.factors.milliseconds'),
                  },
                  {
                    value: '0.000001',
                    label: t('numberFormat.factors.microseconds'),
                  },
                  {
                    value: '0.000000001',
                    label: t('numberFormat.factors.nanoseconds'),
                  },
                ];

                const stringValue =
                  options.find(option => parseFloat(option.value) === value)
                    ?.value ?? '1';

                return (
                  <NativeSelect
                    {...field}
                    size="sm"
                    label={t('numberFormat.inputUnit')}
                    value={stringValue}
                    onChange={e => onChange(parseFloat(e.target.value))}
                    data={options}
                  />
                );
              }}
            />
          ) : !hasNumericUnit(format.output ?? '') ? (
            <>
              <Controller
                control={control}
                key="numberFormat.thousandSeparated"
                name="numberFormat.thousandSeparated"
                render={({ field: { value, onChange, ...field } }) => (
                  <MCheckbox
                    {...field}
                    size="xs"
                    label={t('numberFormat.separateThousands')}
                    description={t('numberFormat.separateThousandsDescription')}
                    checked={value}
                    onChange={onChange}
                  />
                )}
              />
              <Controller
                control={control}
                key="numberFormat.average"
                name="numberFormat.average"
                render={({ field: { value, onChange, ...field } }) => (
                  <MCheckbox
                    {...field}
                    size="xs"
                    label={t('numberFormat.largeNumber')}
                    description={t('numberFormat.largeNumberDescription')}
                    checked={value}
                    onChange={onChange}
                  />
                )}
              />
            </>
          ) : null}
        </Stack>
        {disclaimer}
      </Stack>
    </>
  );
};
