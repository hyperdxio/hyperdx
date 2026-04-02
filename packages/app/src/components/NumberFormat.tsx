import * as React from 'react';
import { useMemo } from 'react';
import {
  Control,
  Controller,
  UseFormSetValue,
  useWatch,
} from 'react-hook-form';
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
  IconNumbers,
  IconPercentage,
} from '@tabler/icons-react';

import { formatNumber } from '../utils';

import { ChartConfigDisplaySettings } from './ChartDisplaySettingsDrawer';

const FORMAT_ICONS: Record<string, React.ReactNode> = {
  number: <IconNumbers size={14} />,
  currency: <IconCurrencyDollar size={14} />,
  percent: <IconPercentage size={14} />,
  byte: <IconDatabase size={14} />,
  time: <IconClock size={14} />,
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

const DATA_UNIT_OPTIONS: UnitOption[] = [
  { value: NumericUnit.BytesIEC, label: 'bytes (IEC)' },
  { value: NumericUnit.BytesSI, label: 'bytes (SI)' },
  { value: NumericUnit.BitsIEC, label: 'bits (IEC)' },
  { value: NumericUnit.BitsSI, label: 'bits (SI)' },
  { value: NumericUnit.Kibibytes, label: 'kibibytes' },
  { value: NumericUnit.Kilobytes, label: 'kilobytes' },
  { value: NumericUnit.Mebibytes, label: 'mebibytes' },
  { value: NumericUnit.Megabytes, label: 'megabytes' },
  { value: NumericUnit.Gibibytes, label: 'gibibytes' },
  { value: NumericUnit.Gigabytes, label: 'gigabytes' },
  { value: NumericUnit.Tebibytes, label: 'tebibytes' },
  { value: NumericUnit.Terabytes, label: 'terabytes' },
  { value: NumericUnit.Pebibytes, label: 'pebibytes' },
  { value: NumericUnit.Petabytes, label: 'petabytes' },
];

const DATA_RATE_UNIT_OPTIONS: UnitOption[] = [
  { value: NumericUnit.PacketsSec, label: 'packets/sec' },
  { value: NumericUnit.BytesSecIEC, label: 'bytes/sec (IEC)' },
  { value: NumericUnit.BytesSecSI, label: 'bytes/sec (SI)' },
  { value: NumericUnit.BitsSecIEC, label: 'bits/sec (IEC)' },
  { value: NumericUnit.BitsSecSI, label: 'bits/sec (SI)' },
  { value: NumericUnit.KibibytesSec, label: 'kibibytes/sec' },
  { value: NumericUnit.KibibitsSec, label: 'kibibits/sec' },
  { value: NumericUnit.KilobytesSec, label: 'kilobytes/sec' },
  { value: NumericUnit.KilobitsSec, label: 'kilobits/sec' },
  { value: NumericUnit.MebibytesSec, label: 'mebibytes/sec' },
  { value: NumericUnit.MebibitsSec, label: 'mebibits/sec' },
  { value: NumericUnit.MegabytesSec, label: 'megabytes/sec' },
  { value: NumericUnit.MegabitsSec, label: 'megabits/sec' },
  { value: NumericUnit.GibibytesSec, label: 'gibibytes/sec' },
  { value: NumericUnit.GibibitsSec, label: 'gibibits/sec' },
  { value: NumericUnit.GigabytesSec, label: 'gigabytes/sec' },
  { value: NumericUnit.GigabitsSec, label: 'gigabits/sec' },
  { value: NumericUnit.TebibytesSec, label: 'tebibytes/sec' },
  { value: NumericUnit.TebibitsSec, label: 'tebibits/sec' },
  { value: NumericUnit.TerabytesSec, label: 'terabytes/sec' },
  { value: NumericUnit.TerabitsSec, label: 'terabits/sec' },
  { value: NumericUnit.PebibytesSec, label: 'pebibytes/sec' },
  { value: NumericUnit.PebibitsSec, label: 'pebibits/sec' },
  { value: NumericUnit.PetabytesSec, label: 'petabytes/sec' },
  { value: NumericUnit.PetabitsSec, label: 'petabits/sec' },
];

const THROUGHPUT_UNIT_OPTIONS: UnitOption[] = [
  { value: NumericUnit.Cps, label: 'counts/sec (cps)' },
  { value: NumericUnit.Ops, label: 'ops/sec (ops)' },
  { value: NumericUnit.Rps, label: 'requests/sec (rps)' },
  { value: NumericUnit.ReadsSec, label: 'reads/sec (rps)' },
  { value: NumericUnit.Wps, label: 'writes/sec (wps)' },
  { value: NumericUnit.Iops, label: 'I/O ops/sec (iops)' },
  { value: NumericUnit.Cpm, label: 'counts/min (cpm)' },
  { value: NumericUnit.Opm, label: 'ops/min (opm)' },
  { value: NumericUnit.RpmReads, label: 'reads/min (rpm)' },
  { value: NumericUnit.Wpm, label: 'writes/min (wpm)' },
];

const UNIT_OPTIONS_BY_OUTPUT: Record<string, UnitOption[]> = {
  byte: DATA_UNIT_OPTIONS,
  data_rate: DATA_RATE_UNIT_OPTIONS,
  throughput: THROUGHPUT_UNIT_OPTIONS,
};

const DEFAULT_NUMERIC_UNIT_BY_OUTPUT: Partial<
  Record<NumberFormat['output'], NumericUnit>
> = {
  byte: NumericUnit.BytesIEC,
  data_rate: NumericUnit.BytesSecIEC,
  throughput: NumericUnit.Cps,
};

const OUTPUT_CATEGORY_OPTIONS: OutputGroup[] = [
  {
    group: 'Basic',
    items: [
      { value: 'number', label: 'Number' },
      { value: 'currency', label: 'Currency' },
      { value: 'percent', label: 'Percentage' },
      { value: 'time', label: 'Time' },
    ],
  },
  {
    group: 'Data',
    items: [{ value: 'byte', label: 'Data' }],
  },
  {
    group: 'Network',
    items: [
      { value: 'data_rate', label: 'Data rate' },
      { value: 'throughput', label: 'Throughput' },
    ],
  },
];

const hasNumericUnit = (output: string) =>
  output === 'byte' || output === 'data_rate' || output === 'throughput';

export const NumberFormatForm: React.FC<{
  control: Control<ChartConfigDisplaySettings>;
  setValue: UseFormSetValue<ChartConfigDisplaySettings>;
}> = ({ control, setValue }) => {
  const format =
    useWatch({ control, name: 'numberFormat' }) ?? DEFAULT_NUMBER_FORMAT;

  const unitOptions = useMemo(
    () =>
      format.output ? (UNIT_OPTIONS_BY_OUTPUT[format.output] ?? null) : null,
    [format.output],
  );

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
                label="Output format"
                leftSection={format.output && FORMAT_ICONS[format.output]}
                style={{ flex: 1 }}
                data={OUTPUT_CATEGORY_OPTIONS}
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
                <TextInput {...field} w={80} label="Symbol" placeholder="$" />
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
                label="Unit"
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
              Example
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

        {format.output !== 'time' && (
          <div>
            <div className="fs-8 mt-2 fw-bold mb-1">Decimals</div>
            <Controller
              control={control}
              key="numberFormat.mantissa"
              name="numberFormat.mantissa"
              render={({ field: { value, onChange } }) => (
                <Slider
                  mb="xl"
                  min={0}
                  max={10}
                  label={val => `Decimals: ${val}`}
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
                    label="Decimal base"
                    description="Use 1KB = 1000 bytes"
                    checked={value}
                    onChange={onChange}
                  />
                );
              }}
            />
          ) : format.output === 'time' ? (
            <Controller
              control={control}
              key="numberFormat.factor"
              name="numberFormat.factor"
              render={({ field: { value, onChange, ...field } }) => {
                const options = [
                  { value: '1', label: 'Seconds' },
                  { value: '0.001', label: 'Milliseconds' },
                  { value: '0.000001', label: 'Microseconds' },
                  { value: '0.000000001', label: 'Nanoseconds' },
                ];

                const stringValue =
                  options.find(option => parseFloat(option.value) === value)
                    ?.value ?? '1';

                return (
                  <NativeSelect
                    {...field}
                    size="sm"
                    label="Input unit"
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
                    label="Separate thousands"
                    description="For example: 1,234,567"
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
                    label="Large number format"
                    description="For example: 1.2m"
                    checked={value}
                    onChange={onChange}
                  />
                )}
              />
            </>
          ) : null}
        </Stack>
      </Stack>
    </>
  );
};
